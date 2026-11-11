# Fixed UIA action: invoke one marked reservation button, never payment controls.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$result = $null
try {
    $raw = [Console]::In.ReadToEnd()
    if ($raw.Length -gt 4096) { throw 'INPUT_INVALID' }
    $request = $raw | ConvertFrom-Json
    $keys = @($request.PSObject.Properties.Name)
    if ($keys.Count -ne 5 -or @($keys | Where-Object { $_ -notin @('token', 'expiresAt', 'probe', 'windowHandle', 'parentPid') }).Count -ne 0) { throw 'INPUT_INVALID' }
    if ($request.token -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' -or $request.probe -isnot [bool]) { throw 'INPUT_INVALID' }
    if ($request.windowHandle -isnot [string] -or $request.windowHandle -notmatch '^[1-9][0-9]{0,15}$') { throw 'UIA_NO_WINDOW' }
    if ($request.expiresAt -isnot [long] -or $request.parentPid -isnot [int] -or $request.parentPid -le 0) { throw 'INPUT_INVALID' }
    if ($request.expiresAt -le [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -or $request.expiresAt -gt [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + 10000) { throw 'UIA_EXPIRED' }
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    Add-Type -ReferencedAssemblies UIAutomationClient, UIAutomationTypes, WindowsBase -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Automation;

public static class KrsReservePress {
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    const string ListUrl = "https://www.korail.com/ticket/search/list";
    static long Now() { return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(); }
    static void Fail(string code) { throw new InvalidOperationException(code); }

    sealed class ParentWatch : IDisposable {
        readonly IntPtr handle;
        readonly Thread thread;
        readonly long deadline;
        volatile bool stopped;
        public ParentWatch(int pid, long expiresAt) {
            deadline = expiresAt;
            handle = OpenProcess(0x100000, false, (uint)pid);
            if (handle == IntPtr.Zero) Fail("UIA_PARENT_EXITED");
            Check();
            thread = new Thread(() => {
                while (!stopped) {
                    if (WaitForSingleObject(handle, 100) != 258 || Now() >= deadline) {
                        if (!stopped) Environment.Exit(3);
                        return;
                    }
                }
            });
            thread.IsBackground = true;
            thread.Start();
        }
        public void Check() {
            if (WaitForSingleObject(handle, 0) != 258) Fail("UIA_PARENT_EXITED");
            if (Now() >= deadline) Fail("UIA_EXPIRED");
        }
        public void Dispose() { stopped = true; thread.Join(500); CloseHandle(handle); }
    }

    static AutomationElement DocumentOf(AutomationElement button, AutomationElement window) {
        var current = button;
        for (int depth = 0; depth < 80 && current != null; depth++) {
            if (Automation.Compare(current, window)) break;
            if (current.Current.ControlType == ControlType.Document) return current;
            current = TreeWalker.ControlViewWalker.GetParent(current);
        }
        Fail("UIA_WRONG_DOCUMENT");
        return null;
    }

    static void Validate(AutomationElement button, AutomationElement window, string name) {
        if (button.Current.Name != name || button.Current.ControlType != ControlType.Button
            || !button.Current.IsEnabled || button.Current.IsOffscreen) Fail("UIA_BUTTON_UNAVAILABLE");
        var document = DocumentOf(button, window);
        object value;
        if (document.Current.IsOffscreen || !document.TryGetCurrentPattern(ValuePattern.Pattern, out value)
            || ((ValuePattern)value).Current.Value != ListUrl) Fail("UIA_WRONG_DOCUMENT");
    }

    public static bool Run(string windowHandle, int parentPid, string token, long expiresAt, bool probe) {
        bool owned = false;
        using (var watch = new ParentWatch(parentPid, expiresAt))
        using (var mutex = new Mutex(false, @"Local\KRS.KTX.ReservePress")) {
            try {
                try { owned = mutex.WaitOne(0); } catch (AbandonedMutexException) { owned = true; }
                if (!owned) Fail("UIA_BUSY");
                watch.Check();
                var hwnd = new IntPtr(long.Parse(windowHandle));
                uint processId = 0;
                if (!IsWindow(hwnd) || GetAncestor(hwnd, 2) != hwnd || GetWindowThreadProcessId(hwnd, out processId) == 0) Fail("UIA_NO_WINDOW");
                using (var browser = Process.GetProcessById((int)processId)) {
                    var browserName = browser.ProcessName.ToLowerInvariant();
                    if (browserName != "chrome" && browserName != "msedge") Fail("UIA_NO_WINDOW");
                }
                var window = AutomationElement.FromHandle(hwnd);
                if (window == null || window.Current.IsOffscreen) Fail("UIA_NO_WINDOW");
                var name = "예매 KRS-" + token;
                var condition = new AndCondition(
                    new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button),
                    new PropertyCondition(AutomationElement.NameProperty, name));
                var matches = window.FindAll(TreeScope.Descendants, condition);
                if (matches.Count != 1) Fail(matches.Count == 0 ? "UIA_MARKER_MISSING" : "UIA_MARKER_AMBIGUOUS");
                var button = matches[0];
                Validate(button, window, name);
                object action;
                if (!button.TryGetCurrentPattern(InvokePattern.Pattern, out action)) Fail("UIA_NOT_INVOKABLE");
                // Re-read identity and lifetime immediately before the sole input.
                watch.Check();
                Validate(button, window, name);
                watch.Check();
                if (probe) return false;
                ((InvokePattern)action).Invoke();
                return true;
            } finally { if (owned) mutex.ReleaseMutex(); }
        }
    }
}
'@
    $pressed = [KrsReservePress]::Run($request.windowHandle, $request.parentPid, $request.token, $request.expiresAt, $request.probe)
    $result = @{ ok = $true; pressed = $pressed }
} catch {
    $code = $_.Exception.GetBaseException().Message
    $messages = @{
        INPUT_INVALID = '예매 입력 요청 형식이 올바르지 않습니다.'
        UIA_EXPIRED = '예매 요청의 유효시간이 지났습니다. 자동으로 재시도하지 않습니다.'
        UIA_PARENT_EXITED = '브릿지 연결이 종료되어 예매하지 않았습니다.'
        UIA_BUSY = '다른 예매 입력을 처리 중입니다. 현재 예약 결과를 먼저 확인해 주세요.'
        UIA_NO_WINDOW = '예매할 브라우저 창을 확인하지 못했습니다.'
        UIA_WRONG_DOCUMENT = '예매 대상 코레일 결과 화면이 아니어서 누르지 않았습니다.'
        UIA_BUTTON_UNAVAILABLE = '예매 단추가 바뀌었거나 사용할 수 없어 누르지 않았습니다.'
        UIA_MARKER_MISSING = '현재 창에서 확인된 예매 단추를 찾지 못했습니다.'
        UIA_MARKER_AMBIGUOUS = '예매 단추를 하나로 특정하지 못해 누르지 않았습니다.'
        UIA_NOT_INVOKABLE = '코레일 예매 단추의 입력 동작을 사용할 수 없습니다.'
    }
    if (-not $messages.ContainsKey($code)) { $code = 'UIA_FAILED'; $message = '예매 입력을 완료했는지 확인하지 못했습니다. 코레일 예약내역을 확인해 주세요.' }
    else { $message = $messages[$code] }
    $result = @{ ok = $false; code = $code; error = $message }
}
[Console]::Out.WriteLine(($result | ConvertTo-Json -Compress))
