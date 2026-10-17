// 생성물 — 고치지 않는다. actions/spec 을 고치고 `node tools/gen-actions.mjs` 를 돌린다.
export const ACTIONS = {
  "version": 1,
  "domains": {
    "attend": {
      "domain": "attend",
      "title": "근태",
      "log": "attend",
      "kinds": [
        "trip",
        "out",
        "flex",
        "leaveout",
        "leave",
        "health",
        "cancel",
        "doc",
        "welfare"
      ],
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — 날짜 칸의 기본값이고 \"내일\"·\"다음 주 수요일\" 셈의 기준(blankForm(kind, today))"
        },
        "me": {
          "from": "me",
          "desc": "내 이름(패널 설정의 myName)"
        }
      },
      "llm": {
        "task": "attend",
        "mode": "merged",
        "partial": true,
        "input": "attend",
        "title": "근태 신청 폼 조각",
        "consumer": {
          "module": "src/attend.js",
          "export": "applyPatch"
        },
        "next": "사용자가 폼을 확인하고 누른다 → attend.<종류> 기록(op=save|request) → src/attend.js buildJob → src/hr.js hrRunJob",
        "role": "당신은 사내 근태 신청 도우미입니다. 사용자의 말에서 근태 신청 폼에 넣을 값을 뽑습니다. 입력에는 오늘 날짜와 달력, 지금 폼(JSON), 앞선 대화, 새 요청이 들어 있습니다.",
        "rules": [
          "**이번 말에서 사용자가 말한 것만** 채웁니다. 말하지 않은 칸은 null 입니다. 장소와 목적을 지어내지 않습니다.",
          "지금 폼에 이미 들어 있는 값을 되풀이하지 않습니다. 바꾸라고 한 것만 넣습니다.",
          "\"내일\", \"다음 주 수요일\" 같은 표현은 오늘을 기준으로 실제 날짜로 바꿉니다. 연도가 없으면 오늘과 같은 해입니다.",
          "요일은 셈하지 말고 입력의 달력 줄에서 찾습니다.",
          "시각은 24시간제 HH:MM 입니다. 외근·외출·건강검진은 30분 단위, 출장·교육은 정시 단위입니다.",
          "\"2시부터 3시간\" 처럼 길이로 말했으면 end 에 끝나는 시각을 셈해 넣습니다.",
          "dateTo 는 여러 날 출장·휴가일 때만 넣습니다. \"1박 2일\"·\"3일간\" 처럼 기간으로 말했으면 days 에 날 수를 넣습니다(당일은 1).",
          "출장이 아니면 venue 는 null 이고 장소는 place 에 넣습니다.",
          "allDay 는 건강검진일 때만 true/false 이고, 그 외에는 null 입니다.",
          "reply 에는 **무엇을 채웠는지만** 한 문장으로 적습니다(\"…채웠습니다\"). 아직 아무것도 올라가지 않았으므로 등록·신청했다고 말하지 않고, 비어 있는 칸은 적지 않습니다(화면이 따로 보여 줍니다)."
        ],
        "fields": {
          "reply": {
            "type": "string",
            "desc": "답 한 줄",
            "read": "무엇을 채웠는지 한국어 한 문장",
            "llm": true,
            "ui": false,
            "max": 300
          }
        }
      }
    },
    "car": {
      "domain": "car",
      "title": "차량",
      "log": "reserve",
      "kinds": [
        "search",
        "reserve",
        "cancel",
        "modify"
      ],
      "preset": {
        "me": {
          "from": "me",
          "desc": "내 이름(패널 설정의 myName — 내 신청 판정에 쓴다. 차량 신청 폼은 로그인한 사람의 이름을 내려 주므로 rememberName 이 채우기도 한다)"
        }
      },
      "llm": {
        "task": "search",
        "mode": "per-kind",
        "partial": false,
        "input": "search",
        "title": "차량 조회 조건",
        "consumer": {
          "module": "src/search.js",
          "export": "findSlots"
        },
        "next": "사용자가 후보를 고른다 → car.reserve 기록 → src/runners.js 의 car 실행자가 신청한다(reserve)",
        "role": "당신은 사내 업무용 차량 예약 도우미입니다. 사용자의 한국어 요청을 차량 조회 조건으로 바꿉니다. 조회 조건은 신청 명령이 아닙니다 — 빈 차량과 시간을 찾을 뿐이고, 신청은 사용자가 후보를 고른 뒤에 나갑니다.",
        "rules": [],
        "fields": {}
      }
    },
    "circulate": {
      "domain": "circulate",
      "title": "회람",
      "log": "circulate",
      "kinds": [
        "run"
      ],
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — 하루에 한 번의 기준(docCirculateState 의 date)"
        }
      },
      "llm": {
        "task": "circulate",
        "mode": "none"
      }
    },
    "gongmun": {
      "domain": "gongmun",
      "title": "공문",
      "log": "gongmun",
      "kinds": [
        "purchase",
        "edu",
        "trip",
        "order",
        "outside",
        "prior"
      ],
      "preset": {
        "me": {
          "from": "me",
          "desc": "기안자(내 이름 — 결재선의 기안, 과제책임자가 본인이면 합의를 뺀다)",
          "required": true
        },
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — writePlan 의 ctx.today(첨부 이름·본문 날짜 자리)"
        },
        "setup": {
          "from": "storage:gongmunPreset",
          "type": "object",
          "desc": "공문 설정(부서·부서장·소장·본부장·문서번호 부서 — 실명은 여기에만 둔다). 어댑터가 writePlan 의 ctx.preset 으로 그대로 넘긴다 — 문서번호·결재선이 여기서 나온다",
          "required": true
        }
      },
      "llm": {
        "task": "gongmun",
        "mode": "recipe"
      }
    },
    "home": {
      "domain": "home",
      "title": "홈 카드",
      "log": "trip",
      "kinds": [
        "evidence",
        "afterup",
        "receipt"
      ],
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD)"
        },
        "me": {
          "from": "me",
          "desc": "내 이름 — 여비계산서 목록이 아는 이름(stages.me)이 비었을 때 대신. intakeEvidence·afterUp·receiptSmart 의 me"
        }
      },
      "llm": {
        "task": "home",
        "mode": "none"
      }
    },
    "mail": {
      "domain": "mail",
      "title": "메일",
      "log": "mail",
      "kinds": [
        "register",
        "refresh",
        "delete",
        "merge",
        "settings"
      ],
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — 보낸 메일 기간·zip 이름의 기준"
        }
      },
      "llm": {
        "task": "mail",
        "mode": "none"
      }
    },
    "rnd": {
      "domain": "rnd",
      "title": "R&D",
      "log": "rnd",
      "kinds": [
        "project",
        "delete",
        "yaml",
        "erp.link",
        "erp.fetch",
        "note.sync",
        "research.share",
        "skills.zip",
        "extract",
        "revise"
      ],
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — 차년도(오늘이 든 것)·변경이력 날짜·zip 이름"
        },
        "me": {
          "from": "me",
          "desc": "내 이름 — 연구내용 페이지의 올린 사람(by)"
        }
      },
      "llm": {
        "task": "rnd",
        "mode": "per-kind",
        "partial": false,
        "input": "rnd",
        "title": "R&D {종류}",
        "consumer": {
          "module": "rndgen/llm.js",
          "export": "askRndTask"
        },
        "next": "답(YAML 전문)을 rndgen/yaml.js 가 검사·마무리하고 미리보기 뒤 사람이 누르면 rnd.intake(장부 넣기)와 rndYamlText 저장이 뒤따른다",
        "role": "당신은 한국선급(KR) 연구개발 과제의 연구개발계획서 스냅샷 YAML(KR_<과제>.yaml)을 다루는 도우미입니다. 이번 일: {종류}. 답은 YAML 글과 몇 개의 짧은 칸뿐입니다 — 파일을 만들거나 폴더를 다루지 않습니다.",
        "rules": [],
        "fields": {}
      }
    },
    "room": {
      "domain": "room",
      "title": "회의실",
      "log": "reserve",
      "kinds": [
        "search",
        "reserve",
        "cancel",
        "modify"
      ],
      "preset": {
        "me": {
          "from": "me",
          "desc": "내 이름(패널 설정의 myName — 내 예약 판정에 쓴다)"
        }
      },
      "llm": {
        "task": "search",
        "mode": "per-kind",
        "partial": false,
        "input": "search",
        "title": "회의실 조회 조건",
        "consumer": {
          "module": "src/search.js",
          "export": "findSlots"
        },
        "next": "사용자가 후보를 고른다 → room.reserve 기록 → src/runners.js 의 room 실행자가 예약한다(reserve)",
        "role": "당신은 사내 회의실 예약 도우미입니다. 사용자의 한국어 요청을 회의실 조회 조건으로 바꿉니다. 조회 조건은 예약 명령이 아닙니다 — 빈 시간을 찾을 뿐이고, 예약은 사용자가 후보를 고른 뒤에 나갑니다.",
        "rules": [],
        "fields": {}
      }
    },
    "trip": {
      "domain": "trip",
      "title": "여비계산서",
      "log": "trip",
      "kinds": [
        "create",
        "presave",
        "preconfirm",
        "postconfirm",
        "after",
        "delete",
        "send",
        "lodge"
      ],
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘 날짜(YYYY-MM-DD)"
        },
        "me": {
          "from": "me",
          "desc": "내 이름(패널 설정의 myName) — 여비계산서 화면이 아는 이름(종류 파일의 tripMe)이 비었을 때 대신 쓴다"
        }
      },
      "llm": {
        "task": "trip",
        "mode": "none"
      }
    }
  },
  "actions": {
    "attend.trip": {
      "id": "attend.trip",
      "domain": "attend",
      "kind": "trip",
      "title": "출장 신청",
      "hint": "출장",
      "status": "live",
      "confirm": true,
      "effect": "write",
      "log": "attend",
      "summary": "출장 {dateFrom}~{dateTo} {place} · {purpose}",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — 날짜 칸의 기본값이고 \"내일\"·\"다음 주 수요일\" 셈의 기준(blankForm(kind, today))"
        },
        "me": {
          "from": "me",
          "desc": "내 이름(패널 설정의 myName)"
        },
        "hrMe": {
          "from": "ctx:hrMe",
          "type": "object",
          "desc": "HR 의 나(사번 emplNo·이름 — attendpanel 의 st.me). 이어지는 여비계산서(trip.create)가 사번을 쓴다"
        },
        "workplace": {
          "from": "storage:attendWorkplace",
          "desc": "근무지(서울·부산) — 근태 탭에 한 번 적으면 남는다(attendpanel 이 attendWorkplace 에 저장). 칸의 workplace 가 비면 이것"
        }
      },
      "fields": {
        "dateFrom": {
          "type": "date",
          "required": true,
          "label": "출발일",
          "desc": "출발일",
          "read": "출발일(YYYY-MM-DD). \"내일\"·\"다음 주 수요일\" 은 오늘을 기준으로 실제 날짜로",
          "llm": true,
          "ui": true,
          "example": "2026-10-20"
        },
        "start": {
          "type": "time",
          "required": true,
          "label": "출발",
          "desc": "출발 시각(정시 단위 — 사이트가 출장의 분 칸을 잠근다)",
          "read": "출발 시각 HH:MM(정시 단위). 말하지 않았으면 null — 폼의 기본값 07:00 이 그대로다",
          "llm": true,
          "ui": true,
          "default": "07:00",
          "example": "07:00"
        },
        "dateTo": {
          "type": "date",
          "required": true,
          "label": "도착일",
          "desc": "도착일 — 며칠간(days)에서 나온다(settle/tripDates). 달력으로 고르면 며칠간이 따라 바뀐다(2026-10-06 사용자 지정)",
          "read": "여러 날 출장의 종료일(YYYY-MM-DD). 당일이면 null",
          "llm": true,
          "ui": true,
          "example": "2026-10-21"
        },
        "end": {
          "type": "time",
          "required": true,
          "label": "도착",
          "desc": "도착 시각(정시 단위)",
          "read": "도착 시각 HH:MM(정시 단위). 말하지 않았으면 null — 폼의 기본값 20:00",
          "llm": true,
          "ui": true,
          "default": "20:00",
          "example": "20:00"
        },
        "days": {
          "type": "integer",
          "required": true,
          "label": "며칠간",
          "desc": "며칠간(당일 1, 1박 2일이면 2) — 칩 1D~7D, 그보다 길면 도착일 달력에서",
          "read": "며칠간인지(당일 1, 1박 2일이면 2). \"3일간\" 처럼 기간으로 말했을 때",
          "llm": true,
          "ui": true,
          "default": 1,
          "example": 2,
          "min": 1,
          "max": 31
        },
        "place": {
          "type": "string",
          "required": true,
          "label": "출장지",
          "desc": "출장지(도시·지역) — 내릴 KTX 역을 여기서 찾는다. 여비계산서에는 \"출장지(장소)\" 로 들어간다(src/travel.js tripLocation)",
          "read": "출장지 — 도시·지역(예: 대전). \"대전 한국기계연구원\" 이면 대전",
          "llm": true,
          "ui": true,
          "example": "대전",
          "max": 200
        },
        "venue": {
          "type": "string",
          "label": "장소",
          "desc": "찾아갈 기관·건물(출장지·장소는 사전정산과 상관없이 늘 묻는다 — 2026-10-08 사용자 지정)",
          "read": "장소 — 찾아갈 기관·건물(예: 한국기계연구원). 장소만 말했으면(\"KAIST\") 그 장소가 있는 도시를 place 에, 장소를 venue 에",
          "llm": true,
          "ui": true,
          "example": "한국기계연구원",
          "max": 200
        },
        "purpose": {
          "type": "string",
          "required": true,
          "label": "목적",
          "desc": "목적 — HR 신청서의 \"내용\" 칸이다. 출장지·장소(사전정산이면 근무지도)가 뒤에 괄호로 붙어 올라간다(src/attend.js contentOf)",
          "read": "목적·사유. 사용자가 말한 것만 — 지어내지 않습니다",
          "llm": true,
          "ui": true,
          "example": "착수회의 참석",
          "max": 200
        },
        "settle": {
          "type": "boolean",
          "label": "여비계산서 사전정산",
          "desc": "결재요청이 올라간 뒤 eclass 여비계산서(사전정산)를 자동으로 만든다(2026-10-02 사용자 지정) — then 의 trip.create",
          "read": "사용자가 여비계산서·사전정산을 말했을 때만 true",
          "llm": false,
          "ui": true,
          "default": false
        },
        "car": {
          "type": "boolean",
          "label": "차량 조회",
          "desc": "폼의 날짜·시간에 빈 차량을 폼 아래에 보여 주고, 누르면 그 차량을 신청한다(2026-10-03 사용자 지정, src/carfind.js) — then 의 car.reserve",
          "read": "사용자가 차량을 말했을 때만 true",
          "llm": false,
          "ui": true,
          "default": false
        },
        "workplace": {
          "type": "string",
          "label": "근무지",
          "desc": "떠나는 근무지(서울·부산). 사전정산을 켰을 때 묻고(기차가 끼면 KTX 역을 찾으므로 그때만 필수 — 기존 검증기 몫), 차량 조회만 켰을 때도 받는다(차량의 지역)",
          "read": "근무지 — 서울 또는 부산",
          "llm": false,
          "ui": true,
          "max": 50
        },
        "transport": {
          "type": "tags",
          "label": "교통편",
          "desc": "교통편(여럿 — 기차 + 비행기). 사전정산을 켰을 때만 묻는다",
          "read": "기차(train)·비행기(plane)·버스(bus) 가운데 말한 것",
          "llm": false,
          "ui": true,
          "when": "settle",
          "default": [
            "train"
          ],
          "values": [
            "train",
            "plane",
            "bus"
          ]
        },
        "trainGrade": {
          "type": "enum",
          "label": "좌석 등급",
          "desc": "기차 좌석 등급(standard 일반석·first 특실) — 교통편 아이콘 안의 값이라 fieldsFor 에는 따로 없다",
          "read": "특실이라고 했을 때만 first",
          "llm": false,
          "ui": true,
          "when": "settle",
          "default": "standard",
          "values": [
            "standard",
            "first"
          ]
        },
        "expense": {
          "type": "enum",
          "label": "출장경비",
          "desc": "출장경비(HR 의 biztripExpKind). 묻지 않는다 — 늘 선급 예산이라(2026-10-02 사용자 지정) blankForm 이 깐 'Y' 를 그대로 보낸다",
          "read": "사용자가 정하지 않습니다 — 늘 Y",
          "llm": false,
          "ui": false,
          "default": "Y",
          "values": [
            "Y",
            "N"
          ]
        },
        "op": {
          "type": "enum",
          "required": true,
          "label": "올리는 길",
          "desc": "임시저장(save)·결재요청(request) — 누른 버튼. 둘은 다른 확인이다(기록이 다르다)",
          "read": "사용자가 말로 고르지 않습니다 — 버튼이 정합니다(임시저장이면 save, 결재요청이면 request)",
          "llm": false,
          "ui": false,
          "values": [
            "save",
            "request"
          ]
        },
        "doc": {
          "type": "object",
          "label": "고쳐 올리는 문서",
          "desc": "임시저장해 둔 문서를 열어 고쳐 올릴 때 그 문서(없으면 새 신청 — buildJob 의 doc). 종류는 못 바꾼다",
          "read": "사용자가 정하지 않습니다 — 신청 내역에서 수정을 누른 문서",
          "llm": false,
          "ui": false,
          "fields": {
            "docNo": {
              "type": "string",
              "required": true,
              "desc": "문서번호",
              "read": "고치는 문서의 번호 그대로",
              "max": 30
            },
            "statusCode": {
              "type": "string",
              "desc": "결재 상태 코드(임시저장 1)",
              "read": "그 문서의 상태 코드 그대로",
              "max": 2
            }
          }
        }
      },
      "ignore": {
        "kind": "행위 ID 가 종류다(attend.trip)",
        "sub": "출장에는 갈래가 없다",
        "half": "연차의 구분 — 출장에는 없다",
        "span": "출장은 날을 넘기므로 몇 시간 칩 대신 출발·도착 시각을 그대로 받는다",
        "flexStart": "유연근무의 칸",
        "flexMode": "유연근무의 칸",
        "flexMon": "유연근무의 칸",
        "flexTue": "유연근무의 칸",
        "flexWed": "유연근무의 칸",
        "flexThu": "유연근무의 칸",
        "flexFri": "유연근무의 칸",
        "allDay": "건강검진의 칸",
        "file": "건강검진의 첨부 — 출장 증빙은 신청할 때 묻지 않는다(신청 내역의 출장 카드에서, 2026-10-03 사용자 지정)",
        "carPlace": "외근의 차량 행선지 — 출장은 출장지(장소)가 행선지다",
        "wfa": "연차의 기념일 지원",
        "wfaName": "연차의 기념일 지원",
        "wfaRelation": "연차의 기념일 지원",
        "wfaReason": "연차의 기념일 지원",
        "wfaDate": "연차의 기념일 지원",
        "wfaStayFrom": "연차의 기념일 지원",
        "wfaStayTo": "연차의 기념일 지원",
        "wfaPaid": "연차의 기념일 지원",
        "wfaAsk": "연차의 기념일 지원",
        "wfaCash": "연차의 기념일 지원"
      },
      "checks": [
        {
          "left": "dateFrom",
          "op": "<=",
          "right": "dateTo",
          "drop": "dateTo",
          "message": "종료일이 시작일보다 앞서 종료일은 뺐습니다"
        }
      ],
      "rules": [
        "출장(trip)은 출장지(place — 도시·지역)와 장소(venue — 찾아갈 기관·건물)를 나눠 넣습니다. \"대전 한국기계연구원\" 이면 place 는 대전, venue 는 한국기계연구원입니다. 장소만 말했으면(\"KAIST\") 그 장소가 있는 도시를 place 에, 장소를 venue 에 넣습니다."
      ],
      "llm": true,
      "task": "attend",
      "runner": "attend.apply",
      "uses": [
        {
          "module": "src/attend.js",
          "export": "buildJob"
        },
        {
          "module": "src/hr.js",
          "export": "hrRunJob"
        }
      ],
      "then": [
        {
          "action": "trip.create",
          "when": "settle"
        },
        {
          "action": "car.reserve",
          "when": "car"
        }
      ],
      "next": "결재요청(op=request) 뒤 HR 신청 내역에서 상태를 확인한다(confirmInList — 최종 성공은 그 뒤). 사전정산을 켰으면 trip.create 가, 차량 조회에서 누른 차는 car.reserve 가 이어진다(패널이 부른다)"
    },
    "attend.out": {
      "id": "attend.out",
      "domain": "attend",
      "kind": "out",
      "title": "외근 신청",
      "hint": "외근·교육·부서소통회",
      "status": "live",
      "confirm": true,
      "effect": "write",
      "log": "attend",
      "summary": "{dateFrom} {start}~{end} {sub} · {purpose}",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — 날짜 칸의 기본값이고 \"내일\"·\"다음 주 수요일\" 셈의 기준(blankForm(kind, today))"
        },
        "me": {
          "from": "me",
          "desc": "내 이름(패널 설정의 myName)"
        }
      },
      "fields": {
        "sub": {
          "type": "enum",
          "required": true,
          "label": "종류",
          "desc": "갈래 — OD(외근)·TR(교육)·MEET(소통 = 부서소통회, 13:00 부터 60분·목적 \"부서소통회\" 가 깔린다)",
          "read": "out 이면 OD(외근)·TR(교육)·MEET(부서소통회)",
          "llm": true,
          "ui": true,
          "default": "OD",
          "example": "OD",
          "values": [
            "OD",
            "TR",
            "MEET"
          ]
        },
        "dateFrom": {
          "type": "date",
          "required": true,
          "label": "날짜",
          "desc": "날짜(하루짜리)",
          "read": "날짜(YYYY-MM-DD). \"내일\"·\"다음 주 수요일\" 은 오늘을 기준으로 실제 날짜로",
          "llm": true,
          "ui": true,
          "example": "2026-10-20"
        },
        "start": {
          "type": "time",
          "required": true,
          "label": "시작",
          "desc": "시작 시각(외근·소통은 30분 단위, 교육은 정시 단위)",
          "read": "시작 시각 HH:MM(외근·소통은 30분 단위, 교육은 정시). 말하지 않았으면 null",
          "llm": true,
          "ui": true,
          "default": "09:00",
          "example": "14:00"
        },
        "span": {
          "type": "integer",
          "required": true,
          "label": "몇 시간",
          "desc": "몇 분인지(칩 — 1~8시간과 30분). 종료 시각(end)은 시작 + 이것이다. 지금 input.yaml 의 attend 작업에 없던 칸이라 LLM 은 end 로 말한다(llm: false)",
          "read": "사용자가 정하지 않습니다 — end(끝나는 시각)에서 폼이 셈합니다",
          "llm": false,
          "ui": true,
          "min": 30,
          "max": 510
        },
        "end": {
          "type": "time",
          "label": "종료",
          "desc": "종료 시각 — 화면 칸이 아니고 시작 + 몇 시간에서 나온다(settle). HR 에는 이것이 간다",
          "read": "종료 시각 HH:MM. \"2시부터 3시간\" 처럼 길이로 말했으면 셈해서",
          "llm": true,
          "ui": false,
          "example": "16:00"
        },
        "purpose": {
          "type": "string",
          "required": true,
          "label": "목적",
          "desc": "목적 — HR 신청서의 \"내용\"(외근에는 장소 칸이 없어 장소를 남기려면 같이 적는다). 소통은 \"부서소통회\" 가 깔린다",
          "read": "목적·사유. 사용자가 말한 것만 — 지어내지 않습니다",
          "llm": true,
          "ui": true,
          "example": "과제 협의 (부산시청)",
          "max": 200
        },
        "place": {
          "type": "string",
          "label": "장소",
          "desc": "외근에는 장소 칸이 없다 — LLM 이 place 에 넣으면 폼(applyPatch)이 목적 뒤에 \"목적 - 장소\" 로 붙이고 이 칸은 비운다",
          "read": "장소(기관·건물·지역). 폼이 목적 뒤에 붙입니다",
          "llm": true,
          "ui": false,
          "example": "부산시청",
          "max": 200
        },
        "car": {
          "type": "boolean",
          "label": "차량 조회",
          "desc": "폼의 날짜·시간에 빈 차량을 폼 아래에 보여 주고, 누르면 그 차량을 신청한다(2026-10-03 사용자 지정, src/carfind.js) — HR 에는 올라가지 않는다",
          "read": "사용자가 차량을 말했을 때만 true",
          "llm": false,
          "ui": true,
          "default": false
        },
        "workplace": {
          "type": "string",
          "label": "근무지",
          "desc": "차량의 근무지(서울·부산 — 차량은 근무지의 것을 잡는다). 차량 조회를 켰을 때 한 줄로 받는다. 한 번 적으면 남는다(attendWorkplace)",
          "read": "근무지 — 서울 또는 부산",
          "llm": false,
          "ui": true,
          "when": "car",
          "max": 50
        },
        "carPlace": {
          "type": "string",
          "label": "행선지",
          "desc": "차량 신청의 행선지(사이트가 요구한다) — 외근 폼에는 출장지 칸이 없어 차량 조회를 켰을 때 따로 받는다. 근태 신청의 필수 칸은 아니다(비면 차량 상자가 말한다)",
          "read": "차량으로 갈 곳(예 부산시청)",
          "llm": false,
          "ui": true,
          "when": "car",
          "max": 100
        },
        "expense": {
          "type": "enum",
          "label": "출장경비",
          "desc": "출장경비(HR 의 biztripExpKind) — 외근은 'N'(blankForm). 묻지 않는다",
          "read": "사용자가 정하지 않습니다 — 외근은 늘 N",
          "llm": false,
          "ui": false,
          "default": "N",
          "values": [
            "Y",
            "N"
          ]
        },
        "op": {
          "type": "enum",
          "required": true,
          "label": "올리는 길",
          "desc": "임시저장(save)·결재요청(request) — 누른 버튼. 둘은 다른 확인이다(기록이 다르다)",
          "read": "사용자가 말로 고르지 않습니다 — 버튼이 정합니다(임시저장이면 save, 결재요청이면 request)",
          "llm": false,
          "ui": false,
          "values": [
            "save",
            "request"
          ]
        },
        "doc": {
          "type": "object",
          "label": "고쳐 올리는 문서",
          "desc": "임시저장해 둔 문서를 열어 고쳐 올릴 때 그 문서(없으면 새 신청 — buildJob 의 doc). 종류는 못 바꾼다",
          "read": "사용자가 정하지 않습니다 — 신청 내역에서 수정을 누른 문서",
          "llm": false,
          "ui": false,
          "fields": {
            "docNo": {
              "type": "string",
              "required": true,
              "desc": "문서번호",
              "read": "고치는 문서의 번호 그대로",
              "max": 30
            },
            "statusCode": {
              "type": "string",
              "desc": "결재 상태 코드(임시저장 1)",
              "read": "그 문서의 상태 코드 그대로",
              "max": 2
            }
          }
        }
      },
      "ignore": {
        "kind": "행위 ID 가 종류다(attend.out)",
        "dateTo": "하루짜리 — settle 이 시작일로 맞추고 HR 에는 시작일이 종료일로 간다(buildJob)",
        "days": "하루짜리(여러 날은 출장·휴가만)",
        "half": "연차의 구분",
        "flexStart": "유연근무의 칸",
        "flexMode": "유연근무의 칸",
        "flexMon": "유연근무의 칸",
        "flexTue": "유연근무의 칸",
        "flexWed": "유연근무의 칸",
        "flexThu": "유연근무의 칸",
        "flexFri": "유연근무의 칸",
        "allDay": "건강검진의 칸",
        "file": "건강검진의 첨부",
        "venue": "출장의 장소 — 외근에는 장소 칸이 없다(place 는 목적 뒤에 붙는다)",
        "settle": "출장의 여비계산서",
        "transport": "출장의 교통편",
        "trainGrade": "출장의 좌석 등급",
        "wfa": "연차의 기념일 지원",
        "wfaName": "연차의 기념일 지원",
        "wfaRelation": "연차의 기념일 지원",
        "wfaReason": "연차의 기념일 지원",
        "wfaDate": "연차의 기념일 지원",
        "wfaStayFrom": "연차의 기념일 지원",
        "wfaStayTo": "연차의 기념일 지원",
        "wfaPaid": "연차의 기념일 지원",
        "wfaAsk": "연차의 기념일 지원",
        "wfaCash": "연차의 기념일 지원"
      },
      "checks": [],
      "rules": [
        "교육은 kind 가 out 이고 sub 가 TR 입니다. 외근이라고 말했으면 sub 는 OD 입니다.",
        "부서소통회(소통회)는 kind 가 out 이고 sub 가 MEET 입니다. 시각(13:00~14:00)과 목적(\"부서소통회\")은 폼이 채우므로, 사용자가 다르게 말했을 때만 start·end·purpose 를 넣습니다."
      ],
      "llm": true,
      "task": "attend",
      "runner": "attend.apply",
      "uses": [
        {
          "module": "src/attend.js",
          "export": "buildJob"
        },
        {
          "module": "src/hr.js",
          "export": "hrRunJob"
        }
      ],
      "then": [
        {
          "action": "car.reserve",
          "when": "car"
        }
      ],
      "next": "결재요청 뒤 HR 신청 내역에서 상태를 확인한다(confirmInList). 차량 조회에서 누른 차는 car.reserve 가 이어진다(패널이 부른다)"
    },
    "attend.flex": {
      "id": "attend.flex",
      "domain": "attend",
      "kind": "flex",
      "title": "유연근무 신청",
      "hint": "유연근무",
      "status": "live",
      "confirm": true,
      "effect": "write",
      "log": "attend",
      "summary": "유연근무 {flexMode} {dateFrom} {flexStart}",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — 날짜 칸의 기본값이고 \"내일\"·\"다음 주 수요일\" 셈의 기준(blankForm(kind, today))"
        },
        "me": {
          "from": "me",
          "desc": "내 이름(패널 설정의 myName)"
        }
      },
      "fields": {
        "flexMode": {
          "type": "enum",
          "required": true,
          "label": "기간",
          "desc": "넣는 길 — day(당일)·week(주간, 요일별)·all(전체, 월~금 모두 같은 시간)",
          "read": "유연근무를 넣는 길. day(당일)·week(주간·요일별)·all(전체·매일·월~금 모두)",
          "llm": true,
          "ui": true,
          "default": "day",
          "example": "day",
          "values": [
            "day",
            "week",
            "all"
          ]
        },
        "dateFrom": {
          "type": "date",
          "required": true,
          "label": "날짜",
          "desc": "당일(day)의 그 날. 주말은 올릴 수 없고 화~목은 07:00·11:00 을 고를 수 없다(problems)",
          "read": "당일 유연근무의 날짜(YYYY-MM-DD). \"내일\"·\"다음 주 수요일\" 은 오늘을 기준으로 실제 날짜로",
          "llm": true,
          "ui": true,
          "when": "flexMode=day",
          "example": "2026-10-20"
        },
        "flexStart": {
          "type": "enum",
          "required": true,
          "label": "출근시간",
          "desc": "당일(day)·전체(all)의 새 출근시간 — 전체는 화~목에 없는 07:00·11:00 을 받지 않는다(flexFit)",
          "read": "유연근무의 새 출근시간(당일·전체일 때)",
          "llm": true,
          "ui": true,
          "when": "flexMode!=week",
          "example": "08:00",
          "values": [
            "07:00",
            "08:00",
            "08:30",
            "09:00",
            "09:30",
            "10:00",
            "11:00"
          ]
        },
        "purpose": {
          "type": "string",
          "required": true,
          "label": "사유",
          "desc": "당일(day)의 사유 — Daily 표의 사유 칸(주간·전체는 받지 않는다)",
          "read": "당일 유연근무의 사유. 사용자가 말한 것만",
          "llm": true,
          "ui": true,
          "when": "flexMode=day",
          "example": "병원 방문",
          "max": 200
        },
        "flexMon": {
          "type": "enum",
          "required": true,
          "label": "월",
          "desc": "주간(week)의 월요일 출근시간",
          "read": "주간 유연근무의 월요일 출근시간",
          "llm": true,
          "ui": true,
          "when": "flexMode=week",
          "values": [
            "07:00",
            "08:00",
            "08:30",
            "09:00",
            "09:30",
            "10:00",
            "11:00"
          ]
        },
        "flexTue": {
          "type": "enum",
          "required": true,
          "label": "화",
          "desc": "주간(week)의 화요일 출근시간",
          "read": "주간 유연근무의 화요일 출근시간",
          "llm": true,
          "ui": true,
          "when": "flexMode=week",
          "values": [
            "08:00",
            "08:30",
            "09:00",
            "09:30",
            "10:00"
          ]
        },
        "flexWed": {
          "type": "enum",
          "required": true,
          "label": "수",
          "desc": "주간(week)의 수요일 출근시간",
          "read": "주간 유연근무의 수요일 출근시간",
          "llm": true,
          "ui": true,
          "when": "flexMode=week",
          "values": [
            "08:00",
            "08:30",
            "09:00",
            "09:30",
            "10:00"
          ]
        },
        "flexThu": {
          "type": "enum",
          "required": true,
          "label": "목",
          "desc": "주간(week)의 목요일 출근시간",
          "read": "주간 유연근무의 목요일 출근시간",
          "llm": true,
          "ui": true,
          "when": "flexMode=week",
          "values": [
            "08:00",
            "08:30",
            "09:00",
            "09:30",
            "10:00"
          ]
        },
        "flexFri": {
          "type": "enum",
          "required": true,
          "label": "금",
          "desc": "주간(week)의 금요일 출근시간",
          "read": "주간 유연근무의 금요일 출근시간",
          "llm": true,
          "ui": true,
          "when": "flexMode=week",
          "values": [
            "07:00",
            "08:00",
            "08:30",
            "09:00",
            "09:30",
            "10:00",
            "11:00"
          ]
        },
        "op": {
          "type": "enum",
          "required": true,
          "label": "올리는 길",
          "desc": "임시저장(save)·결재요청(request) — 누른 버튼. 둘은 다른 확인이다(기록이 다르다)",
          "read": "사용자가 말로 고르지 않습니다 — 버튼이 정합니다(임시저장이면 save, 결재요청이면 request)",
          "llm": false,
          "ui": false,
          "values": [
            "save",
            "request"
          ]
        },
        "doc": {
          "type": "object",
          "label": "고쳐 올리는 문서",
          "desc": "임시저장해 둔 문서를 열어 고쳐 올릴 때 그 문서(없으면 새 신청 — buildJob 의 doc). 저장된 문서는 기간구분(Daily·Weekly)이 잠겨 있다",
          "read": "사용자가 정하지 않습니다 — 신청 내역에서 수정을 누른 문서",
          "llm": false,
          "ui": false,
          "fields": {
            "docNo": {
              "type": "string",
              "required": true,
              "desc": "문서번호",
              "read": "고치는 문서의 번호 그대로",
              "max": 30
            },
            "statusCode": {
              "type": "string",
              "desc": "결재 상태 코드(임시저장 1)",
              "read": "그 문서의 상태 코드 그대로",
              "max": 2
            }
          }
        }
      },
      "ignore": {
        "kind": "행위 ID 가 종류다(attend.flex)",
        "dateTo": "유연근무에는 기간이 없다(당일 하루 또는 주간)",
        "start": "시각 칸이 없다 — 출근시간(flexStart)이 시간대다",
        "end": "시각 칸이 없다",
        "span": "시각 칸이 없다",
        "days": "하루짜리",
        "place": "장소를 쓰지 않는 종류(applyPatch 가 버린다)",
        "venue": "장소를 쓰지 않는 종류",
        "workplace": "출장·외근의 칸",
        "expense": "출장·외근의 칸",
        "allDay": "건강검진의 칸",
        "file": "건강검진의 첨부",
        "settle": "출장의 여비계산서",
        "transport": "출장의 교통편",
        "trainGrade": "출장의 좌석 등급",
        "car": "출장·외근의 차량 조회",
        "carPlace": "외근의 차량 행선지",
        "sub": "유연근무에는 갈래가 없다",
        "half": "연차의 구분",
        "wfa": "연차의 기념일 지원",
        "wfaName": "연차의 기념일 지원",
        "wfaRelation": "연차의 기념일 지원",
        "wfaReason": "연차의 기념일 지원",
        "wfaDate": "연차의 기념일 지원",
        "wfaStayFrom": "연차의 기념일 지원",
        "wfaStayTo": "연차의 기념일 지원",
        "wfaPaid": "연차의 기념일 지원",
        "wfaAsk": "연차의 기념일 지원",
        "wfaCash": "연차의 기념일 지원"
      },
      "checks": [],
      "rules": [
        "flex 는 유연근무(출근시간 변경. 자율출퇴근·시차출근이라고도 말합니다)입니다. 넣는 길(flexMode)은 셋입니다 — day(당일: 그 날 하루), week(주간: 월~금 요일마다), all(전체: 월~금 모두 같은 시간).",
        "flexMode 가 week 이면 말한 요일의 출근시간만 flexMon~flexFri 에 넣고 flexStart 는 null 입니다. day·all 이면 flexStart 를 쓰고 flexMon~flexFri 는 null 입니다.",
        "07:00·11:00 출근은 월요일·금요일에만 있습니다."
      ],
      "llm": true,
      "task": "attend",
      "runner": "attend.apply",
      "uses": [
        {
          "module": "src/attend.js",
          "export": "buildJob"
        },
        {
          "module": "src/hr.js",
          "export": "hrRunJob"
        }
      ],
      "then": [],
      "next": "결재요청 뒤 HR 신청 내역에서 상태를 확인한다. 반차 앞에 올리는 유연근무(halfFlexForm — 출근이 정시가 아닌 날의 반차)도 같은 기록이다(패널이 휴가 기록 앞에 따로 짓는다)"
    },
    "attend.leaveout": {
      "id": "attend.leaveout",
      "domain": "attend",
      "kind": "leaveout",
      "title": "외출 신청",
      "hint": "외출",
      "status": "live",
      "confirm": true,
      "effect": "write",
      "log": "attend",
      "summary": "외출 {dateFrom} {start}~{end} · {purpose}",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — 날짜 칸의 기본값이고 \"내일\"·\"다음 주 수요일\" 셈의 기준(blankForm(kind, today))"
        },
        "me": {
          "from": "me",
          "desc": "내 이름(패널 설정의 myName)"
        }
      },
      "fields": {
        "dateFrom": {
          "type": "date",
          "required": true,
          "label": "날짜",
          "desc": "날짜(하루짜리)",
          "read": "날짜(YYYY-MM-DD). \"내일\"·\"다음 주 수요일\" 은 오늘을 기준으로 실제 날짜로",
          "llm": true,
          "ui": true,
          "example": "2026-10-20"
        },
        "start": {
          "type": "time",
          "required": true,
          "label": "시작",
          "desc": "시작 시각(30분 단위)",
          "read": "시작 시각 HH:MM(30분 단위). 말하지 않았으면 null",
          "llm": true,
          "ui": true,
          "default": "09:00",
          "example": "14:00"
        },
        "span": {
          "type": "integer",
          "required": true,
          "label": "몇 시간",
          "desc": "몇 분인지(칩). 종료 시각(end)은 시작 + 이것이다. LLM 은 end 로 말한다(llm: false)",
          "read": "사용자가 정하지 않습니다 — end(끝나는 시각)에서 폼이 셈합니다",
          "llm": false,
          "ui": true,
          "min": 30,
          "max": 510
        },
        "end": {
          "type": "time",
          "label": "종료",
          "desc": "종료 시각 — 화면 칸이 아니고 시작 + 몇 시간에서 나온다(settle). HR 에는 이것이 간다",
          "read": "종료 시각 HH:MM. \"2시부터 3시간\" 처럼 길이로 말했으면 셈해서",
          "llm": true,
          "ui": false,
          "example": "16:00"
        },
        "purpose": {
          "type": "string",
          "required": true,
          "label": "사유",
          "desc": "사유(HR 의 reqRsn)",
          "read": "사유. 사용자가 말한 것만 — 지어내지 않습니다",
          "llm": true,
          "ui": true,
          "example": "병원 방문",
          "max": 200
        },
        "op": {
          "type": "enum",
          "required": true,
          "label": "올리는 길",
          "desc": "임시저장(save)·결재요청(request) — 누른 버튼. 둘은 다른 확인이다(기록이 다르다)",
          "read": "사용자가 말로 고르지 않습니다 — 버튼이 정합니다(임시저장이면 save, 결재요청이면 request)",
          "llm": false,
          "ui": false,
          "values": [
            "save",
            "request"
          ]
        },
        "doc": {
          "type": "object",
          "label": "고쳐 올리는 문서",
          "desc": "임시저장해 둔 문서를 열어 고쳐 올릴 때 그 문서(없으면 새 신청 — buildJob 의 doc)",
          "read": "사용자가 정하지 않습니다 — 신청 내역에서 수정을 누른 문서",
          "llm": false,
          "ui": false,
          "fields": {
            "docNo": {
              "type": "string",
              "required": true,
              "desc": "문서번호",
              "read": "고치는 문서의 번호 그대로",
              "max": 30
            },
            "statusCode": {
              "type": "string",
              "desc": "결재 상태 코드(임시저장 1)",
              "read": "그 문서의 상태 코드 그대로",
              "max": 2
            }
          }
        }
      },
      "ignore": {
        "kind": "행위 ID 가 종류다(attend.leaveout)",
        "dateTo": "하루짜리 — settle 이 시작일로 맞추고 HR 에는 시작일이 종료일로 간다",
        "days": "하루짜리",
        "place": "장소를 쓰지 않는 종류(applyPatch 가 버린다)",
        "venue": "장소를 쓰지 않는 종류",
        "workplace": "출장·외근의 칸",
        "expense": "출장·외근의 칸",
        "flexStart": "유연근무의 칸",
        "flexMode": "유연근무의 칸",
        "flexMon": "유연근무의 칸",
        "flexTue": "유연근무의 칸",
        "flexWed": "유연근무의 칸",
        "flexThu": "유연근무의 칸",
        "flexFri": "유연근무의 칸",
        "allDay": "건강검진의 칸",
        "file": "건강검진의 첨부",
        "settle": "출장의 여비계산서",
        "transport": "출장의 교통편",
        "trainGrade": "출장의 좌석 등급",
        "car": "출장·외근의 차량 조회",
        "carPlace": "외근의 차량 행선지",
        "sub": "외출에는 갈래가 없다",
        "half": "연차의 구분",
        "wfa": "연차의 기념일 지원",
        "wfaName": "연차의 기념일 지원",
        "wfaRelation": "연차의 기념일 지원",
        "wfaReason": "연차의 기념일 지원",
        "wfaDate": "연차의 기념일 지원",
        "wfaStayFrom": "연차의 기념일 지원",
        "wfaStayTo": "연차의 기념일 지원",
        "wfaPaid": "연차의 기념일 지원",
        "wfaAsk": "연차의 기념일 지원",
        "wfaCash": "연차의 기념일 지원"
      },
      "checks": [],
      "rules": [],
      "llm": true,
      "task": "attend",
      "runner": "attend.apply",
      "uses": [
        {
          "module": "src/attend.js",
          "export": "buildJob"
        },
        {
          "module": "src/hr.js",
          "export": "hrRunJob"
        }
      ],
      "then": [],
      "next": "결재요청 뒤 HR 신청 내역에서 상태를 확인한다(confirmInList)"
    },
    "attend.leave": {
      "id": "attend.leave",
      "domain": "attend",
      "kind": "leave",
      "title": "휴가 신청",
      "hint": "휴가",
      "status": "live",
      "confirm": true,
      "effect": "write",
      "log": "attend",
      "summary": "{sub} {dateFrom}~{dateTo} {days}일 {half}",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — 날짜 칸의 기본값이고 \"내일\"·\"다음 주 수요일\" 셈의 기준(blankForm(kind, today))"
        },
        "me": {
          "from": "me",
          "desc": "내 이름(패널 설정의 myName)"
        }
      },
      "fields": {
        "sub": {
          "type": "enum",
          "required": true,
          "label": "종류",
          "desc": "갈래 — LY(연차·반차)·LH(체력단련, HR 의 체력관리)",
          "read": "leave 이면 LY(연차·반차)·LH(체력단련)",
          "llm": true,
          "ui": true,
          "default": "LY",
          "example": "LY",
          "values": [
            "LY",
            "LH"
          ]
        },
        "dateFrom": {
          "type": "date",
          "required": true,
          "label": "시작일",
          "desc": "시작일(연차휴가 사용일의 첫날)",
          "read": "시작일(YYYY-MM-DD). \"내일\"·\"다음 주 수요일\" 은 오늘을 기준으로 실제 날짜로",
          "llm": true,
          "ui": true,
          "example": "2026-10-20"
        },
        "dateTo": {
          "type": "date",
          "required": true,
          "label": "종료일",
          "desc": "종료일 — 며칠간(days)에서 나온다(settle/tripDates). 달력으로 고르면 며칠간이 따라 바뀐다",
          "read": "여러 날 휴가의 종료일(YYYY-MM-DD). 하루면 null",
          "llm": true,
          "ui": true,
          "example": "2026-10-21"
        },
        "days": {
          "type": "integer",
          "required": true,
          "label": "며칠간",
          "desc": "며칠간(하루 1) — 칩 1D~5D(2026-10-02 사용자 지정), 그보다 길면 종료일 달력에서",
          "read": "며칠간인지(하루 1, 이틀이면 2). \"3일간\" 처럼 기간으로 말했을 때",
          "llm": true,
          "ui": true,
          "default": 1,
          "example": 2,
          "min": 1,
          "max": 31
        },
        "half": {
          "type": "enum",
          "label": "구분",
          "desc": "하루짜리 연차의 구분 — am(오전 반차)·pm(오후 반차)·전일(빈 값). 여러 날이거나 체력단련이면 전일로 잠긴다(locked)",
          "read": "하루짜리 연차의 구분. am(오전 반차)·pm(오후 반차)·full(전일). 휴가가 아니면 null",
          "llm": true,
          "ui": true,
          "example": "am",
          "values": [
            "am",
            "pm",
            "full"
          ]
        },
        "wfa": {
          "type": "boolean",
          "label": "기념일 지원",
          "desc": "가족 기념일(생일·결혼기념일·어린이날 …)에 쓰는 연차면 켠다 — 결재요청 뒤 eclass 의 가족 기념일 지원 신청 화면을 채워 연다(src/welfare.js). 연차(LY)에만 있다",
          "read": "연차를 가족 기념일(생일·결혼기념일·어린이날 …)에 쓰는가 — \"기념일\"·\"기념일 지원\" 이라고 말했을 때만 true. 그 밖에는 null",
          "llm": true,
          "ui": true,
          "when": "sub=LY",
          "default": false
        },
        "wfaReason": {
          "type": "enum",
          "required": true,
          "label": "신청사항",
          "desc": "신청사항(기념일의 종류)",
          "read": "어떤 기념일인지 — 목록의 이름 그대로",
          "llm": false,
          "ui": true,
          "when": "wfa",
          "values": [
            "생일(양력)",
            "결혼기념일",
            "자녀 입학식",
            "자녀 졸업식",
            "자녀 방학",
            "신정",
            "어린이날",
            "어버이날",
            "세계가정의날",
            "부부의날",
            "부처님오신날",
            "창립기념일",
            "노조 창립기념일",
            "추석",
            "크리스마스",
            "설날",
            "생일(음력)"
          ]
        },
        "wfaDate": {
          "type": "date",
          "required": true,
          "label": "기념일",
          "desc": "기념일 날짜",
          "read": "기념일(YYYY-MM-DD)",
          "llm": false,
          "ui": true,
          "when": "wfa"
        },
        "wfaName": {
          "type": "string",
          "required": true,
          "label": "대상자",
          "desc": "대상자(본인 또는 가족 이름)",
          "read": "기념일의 대상자 이름",
          "llm": false,
          "ui": true,
          "when": "wfa",
          "max": 50
        },
        "wfaRelation": {
          "type": "enum",
          "required": true,
          "label": "가족관계",
          "desc": "대상자와의 관계",
          "read": "대상자와의 관계 — 목록의 이름 그대로",
          "llm": false,
          "ui": true,
          "when": "wfa",
          "default": "본인",
          "values": [
            "본인",
            "배우자",
            "부모",
            "형제,자매",
            "자녀",
            "배우자 부모"
          ]
        },
        "wfaStayFrom": {
          "type": "date",
          "label": "시설 시작일",
          "desc": "시설 이용 시작일(숙박 등 — 없으면 비운다. 시작·종료를 같이 적는다)",
          "read": "시설을 이용했으면 그 시작일(YYYY-MM-DD)",
          "llm": false,
          "ui": true,
          "when": "wfa"
        },
        "wfaStayTo": {
          "type": "date",
          "label": "시설 종료일",
          "desc": "시설 이용 종료일",
          "read": "시설을 이용했으면 그 종료일(YYYY-MM-DD)",
          "llm": false,
          "ui": true,
          "when": "wfa"
        },
        "wfaPaid": {
          "type": "string",
          "label": "결제금액",
          "desc": "결제금액(원 — 영수증 금액. 쉼표·원은 걷는다 wonOf). 다녀온 뒤에야 알면 비워 두고 신청 화면에서 적는다",
          "read": "영수증의 결제 금액(숫자만)",
          "llm": false,
          "ui": true,
          "when": "wfa",
          "max": 20
        },
        "wfaAsk": {
          "type": "string",
          "label": "신청금액",
          "desc": "신청금액(원 — 이용일당 150,000 까지, src/welfare.js WFA_MAX). 결제금액을 넘을 수 없다",
          "read": "신청할 금액(숫자만, 150000 까지)",
          "llm": false,
          "ui": true,
          "when": "wfa",
          "max": 20
        },
        "wfaCash": {
          "type": "enum",
          "label": "사용구분",
          "desc": "결제 수단 — 1(현금영수증)·2(신용카드)·3(체크카드)",
          "read": "현금영수증이면 1, 신용카드면 2, 체크카드면 3",
          "llm": false,
          "ui": true,
          "when": "wfa",
          "values": [
            "1",
            "2",
            "3"
          ]
        },
        "op": {
          "type": "enum",
          "required": true,
          "label": "올리는 길",
          "desc": "임시저장(save)·결재요청(request) — 누른 버튼. 둘은 다른 확인이다(기록이 다르다)",
          "read": "사용자가 말로 고르지 않습니다 — 버튼이 정합니다(임시저장이면 save, 결재요청이면 request)",
          "llm": false,
          "ui": false,
          "values": [
            "save",
            "request"
          ]
        },
        "doc": {
          "type": "object",
          "label": "고쳐 올리는 문서",
          "desc": "임시저장해 둔 문서를 열어 고쳐 올릴 때 그 문서(없으면 새 신청 — buildJob 의 doc)",
          "read": "사용자가 정하지 않습니다 — 신청 내역에서 수정을 누른 문서",
          "llm": false,
          "ui": false,
          "fields": {
            "docNo": {
              "type": "string",
              "required": true,
              "desc": "문서번호",
              "read": "고치는 문서의 번호 그대로",
              "max": 30
            },
            "statusCode": {
              "type": "string",
              "desc": "결재 상태 코드(임시저장 1)",
              "read": "그 문서의 상태 코드 그대로",
              "max": 2
            }
          }
        }
      },
      "ignore": {
        "kind": "행위 ID 가 종류다(attend.leave)",
        "start": "휴가에는 시각 칸이 없다 — 시각으로 말하면 오전·오후로 읽는다(halfFromTimes)",
        "end": "휴가에는 시각 칸이 없다",
        "span": "휴가에는 시각 칸이 없다",
        "place": "휴가에는 장소·목적이 없다",
        "venue": "휴가에는 장소·목적이 없다",
        "purpose": "연차·체력단련은 HR 이 사유를 받지 않는다(사유 줄이 숨어 있다)",
        "workplace": "출장·외근의 칸",
        "expense": "출장·외근의 칸",
        "flexStart": "유연근무의 칸",
        "flexMode": "유연근무의 칸",
        "flexMon": "유연근무의 칸",
        "flexTue": "유연근무의 칸",
        "flexWed": "유연근무의 칸",
        "flexThu": "유연근무의 칸",
        "flexFri": "유연근무의 칸",
        "allDay": "건강검진의 칸",
        "file": "건강검진의 첨부",
        "settle": "출장의 여비계산서",
        "transport": "출장의 교통편",
        "trainGrade": "출장의 좌석 등급",
        "car": "출장·외근의 차량 조회",
        "carPlace": "외근의 차량 행선지"
      },
      "checks": [
        {
          "left": "dateFrom",
          "op": "<=",
          "right": "dateTo",
          "drop": "dateTo",
          "message": "종료일이 시작일보다 앞서 종료일은 뺐습니다"
        },
        {
          "left": "wfaStayFrom",
          "op": "<=",
          "right": "wfaStayTo",
          "message": "시설 종료일이 시작일보다 앞섭니다"
        }
      ],
      "rules": [
        "휴가(leave)의 sub 는 LY(연차·반차) 또는 LH(체력단련·체력관리)이고, 그냥 \"휴가\"라고만 했으면 sub 는 null 입니다.",
        "\"오전 반차\"·\"오후 반차\"는 half 에 am·pm 을, 하루 종일이라고 했으면 full 을 넣습니다. 휴가에는 장소·목적이 없습니다.",
        "\"가족 기념일\"·\"기념일 지원\"·\"결혼기념일에 연차\" 처럼 기념일을 말했으면 kind 는 leave, sub 는 LY, wfa 는 true 입니다. 기념일의 내용(대상자·신청사항·금액)은 폼의 칸에서 적으므로 넣지 않습니다."
      ],
      "llm": true,
      "task": "attend",
      "runner": "attend.apply",
      "uses": [
        {
          "module": "src/attend.js",
          "export": "buildJob"
        },
        {
          "module": "src/hr.js",
          "export": "hrRunJob"
        }
      ],
      "then": [
        {
          "action": "attend.welfare",
          "when": "wfa"
        }
      ],
      "next": "결재요청 뒤 HR 신청 내역에서 상태를 확인한다. 기념일 지원을 켰으면 eclass 의 신청 화면을 채워 연다(attend.welfare — 2단계까지는 attendpanel.js fillWelfare 가 바로 한다)"
    },
    "attend.health": {
      "id": "attend.health",
      "domain": "attend",
      "kind": "health",
      "title": "건강검진 신청",
      "hint": "건강검진",
      "status": "live",
      "confirm": true,
      "effect": "write",
      "log": "attend",
      "summary": "건강검진 {dateFrom} {start}~{end} · {purpose}",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — 날짜 칸의 기본값이고 \"내일\"·\"다음 주 수요일\" 셈의 기준(blankForm(kind, today))"
        },
        "me": {
          "from": "me",
          "desc": "내 이름(패널 설정의 myName)"
        }
      },
      "fields": {
        "dateFrom": {
          "type": "date",
          "required": true,
          "label": "날짜",
          "desc": "검진 날짜(하루짜리)",
          "read": "날짜(YYYY-MM-DD). \"내일\"·\"다음 주 수요일\" 은 오늘을 기준으로 실제 날짜로",
          "llm": true,
          "ui": true,
          "example": "2026-10-20"
        },
        "allDay": {
          "type": "boolean",
          "label": "하루 전체",
          "desc": "하루 전체로 올리는가(휴가구분 01). 끄면 시작과 몇 시간을 받는다(04)",
          "read": "건강검진을 하루 전체로 올리는가. 건강검진이 아니면 null",
          "llm": true,
          "ui": true,
          "default": true,
          "example": true
        },
        "start": {
          "type": "time",
          "required": true,
          "label": "시작",
          "desc": "시작 시각(30분 단위) — 하루 전체가 아닐 때",
          "read": "시작 시각 HH:MM(30분 단위). 하루 전체면 null",
          "llm": true,
          "ui": true,
          "when": "!allDay",
          "default": "09:00",
          "example": "09:00"
        },
        "span": {
          "type": "integer",
          "required": true,
          "label": "몇 시간",
          "desc": "몇 분인지(칩) — 하루 전체가 아닐 때. 종료 시각(end)은 시작 + 이것이다. LLM 은 end 로 말한다(llm: false)",
          "read": "사용자가 정하지 않습니다 — end(끝나는 시각)에서 폼이 셈합니다",
          "llm": false,
          "ui": true,
          "when": "!allDay",
          "min": 30,
          "max": 510
        },
        "end": {
          "type": "time",
          "label": "종료",
          "desc": "종료 시각 — 화면 칸이 아니고 시작 + 몇 시간에서 나온다(settle). 하루 전체가 아닐 때 HR 에 간다",
          "read": "종료 시각 HH:MM. \"2시부터 3시간\" 처럼 길이로 말했으면 셈해서",
          "llm": true,
          "ui": false,
          "when": "!allDay",
          "example": "12:00"
        },
        "purpose": {
          "type": "string",
          "required": true,
          "label": "사유",
          "desc": "사유(HR 의 reqRsn — 사이트가 반드시 요구한다)",
          "read": "사유. 사용자가 말한 것만 — 지어내지 않습니다",
          "llm": true,
          "ui": true,
          "example": "건강검진",
          "max": 200
        },
        "file": {
          "type": "file",
          "label": "첨부파일",
          "desc": "검진 확인서 등(사이트가 반드시 요구한다 — 이미 올려 둔 파일이 있는 문서를 고칠 때는 비워도 된다, hasFile). 기록에는 이름·형식만 남고 바이트는 ctx.files 로 간다",
          "read": "사용자가 넣은 파일의 이름과 형식. 지어내지 않습니다",
          "llm": false,
          "ui": true
        },
        "op": {
          "type": "enum",
          "required": true,
          "label": "올리는 길",
          "desc": "임시저장(save)·결재요청(request) — 누른 버튼. 둘은 다른 확인이다(기록이 다르다)",
          "read": "사용자가 말로 고르지 않습니다 — 버튼이 정합니다(임시저장이면 save, 결재요청이면 request)",
          "llm": false,
          "ui": false,
          "values": [
            "save",
            "request"
          ]
        },
        "doc": {
          "type": "object",
          "label": "고쳐 올리는 문서",
          "desc": "임시저장해 둔 문서를 열어 고쳐 올릴 때 그 문서(없으면 새 신청 — buildJob 의 doc)",
          "read": "사용자가 정하지 않습니다 — 신청 내역에서 수정을 누른 문서",
          "llm": false,
          "ui": false,
          "fields": {
            "docNo": {
              "type": "string",
              "required": true,
              "desc": "문서번호",
              "read": "고치는 문서의 번호 그대로",
              "max": 30
            },
            "statusCode": {
              "type": "string",
              "desc": "결재 상태 코드(임시저장 1)",
              "read": "그 문서의 상태 코드 그대로",
              "max": 2
            }
          }
        }
      },
      "ignore": {
        "kind": "행위 ID 가 종류다(attend.health)",
        "dateTo": "하루짜리 — settle 이 시작일로 맞추고 HR 에는 시작일이 종료일로 간다",
        "days": "하루짜리",
        "place": "장소를 쓰지 않는 종류(applyPatch 가 버린다)",
        "venue": "장소를 쓰지 않는 종류",
        "workplace": "출장·외근의 칸",
        "expense": "출장·외근의 칸",
        "flexStart": "유연근무의 칸",
        "flexMode": "유연근무의 칸",
        "flexMon": "유연근무의 칸",
        "flexTue": "유연근무의 칸",
        "flexWed": "유연근무의 칸",
        "flexThu": "유연근무의 칸",
        "flexFri": "유연근무의 칸",
        "settle": "출장의 여비계산서",
        "transport": "출장의 교통편",
        "trainGrade": "출장의 좌석 등급",
        "car": "출장·외근의 차량 조회",
        "carPlace": "외근의 차량 행선지",
        "sub": "건강검진에는 갈래가 없다",
        "half": "연차의 구분",
        "wfa": "연차의 기념일 지원",
        "wfaName": "연차의 기념일 지원",
        "wfaRelation": "연차의 기념일 지원",
        "wfaReason": "연차의 기념일 지원",
        "wfaDate": "연차의 기념일 지원",
        "wfaStayFrom": "연차의 기념일 지원",
        "wfaStayTo": "연차의 기념일 지원",
        "wfaPaid": "연차의 기념일 지원",
        "wfaAsk": "연차의 기념일 지원",
        "wfaCash": "연차의 기념일 지원"
      },
      "checks": [],
      "rules": [
        "하루 전체라고 했으면 allDay 는 true, 시각을 말했으면 false 입니다."
      ],
      "llm": true,
      "task": "attend",
      "runner": "attend.apply",
      "uses": [
        {
          "module": "src/attend.js",
          "export": "buildJob"
        },
        {
          "module": "src/hr.js",
          "export": "hrRunJob"
        }
      ],
      "then": [],
      "next": "결재요청 뒤 HR 신청 내역에서 상태를 확인한다(confirmInList). 첨부는 어댑터가 기록의 파일 이름으로 ctx.files 에서 찾아 buildJob 의 file op 에 넣는다"
    },
    "attend.cancel": {
      "id": "attend.cancel",
      "domain": "attend",
      "kind": "cancel",
      "title": "근태 취소신청",
      "hint": "취소신청",
      "status": "live",
      "confirm": true,
      "effect": "write",
      "log": "attend",
      "summary": "취소신청 {formId} {docNo} · {reason}",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — 날짜 칸의 기본값이고 \"내일\"·\"다음 주 수요일\" 셈의 기준(blankForm(kind, today))"
        },
        "me": {
          "from": "me",
          "desc": "내 이름(패널 설정의 myName)"
        }
      },
      "fields": {
        "docNo": {
          "type": "string",
          "required": true,
          "label": "문서번호",
          "desc": "무를 원 문서의 번호(결재완료 건)",
          "read": "신청 내역에서 고른 문서번호 그대로. 지어내지 않습니다",
          "llm": true,
          "ui": true,
          "example": "202610-11115-0002",
          "max": 30
        },
        "formId": {
          "type": "enum",
          "required": true,
          "label": "신청서",
          "desc": "원 문서의 신청서 — TRO 외근/교육 · TR 출장 · LV 휴가/공가 · ET 기타(외출). 취소신청서가 있는 것만",
          "read": "신청 내역 줄의 formId 그대로",
          "llm": true,
          "ui": true,
          "example": "TR",
          "values": [
            "TRO",
            "TR",
            "LV",
            "ET"
          ]
        },
        "reason": {
          "type": "string",
          "required": true,
          "label": "취소 사유",
          "desc": "취소 사유(필수 — 취소신청서의 사유 칸, buildCancelJob)",
          "read": "사용자가 말한 취소 사유. 지어내지 않습니다",
          "llm": true,
          "ui": true,
          "example": "일정 변경",
          "max": 200
        }
      },
      "checks": [],
      "rules": [],
      "llm": false,
      "runner": "attend.cancel",
      "uses": [
        {
          "module": "src/attend.js",
          "export": "buildCancelJob"
        },
        {
          "module": "src/hr.js",
          "export": "hrRunJob"
        }
      ],
      "then": [
        {
          "action": "trip.delete",
          "when": "formId=TR"
        }
      ],
      "next": "올린 뒤 confirmInList 로 목록을 다시 읽는다(원 문서는 승인까지 그대로다). 패널이 \"취소 중\" 기록(attendCancelling)을 적고, 출장이면 여비계산서를 지운다(trip.delete)"
    },
    "attend.doc": {
      "id": "attend.doc",
      "domain": "attend",
      "kind": "doc",
      "title": "근태 문서 상신·회수·삭제",
      "hint": "상신·회수·삭제",
      "status": "live",
      "confirm": true,
      "effect": "write",
      "log": "attend",
      "summary": "{action} {formId} {docNo}",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — 날짜 칸의 기본값이고 \"내일\"·\"다음 주 수요일\" 셈의 기준(blankForm(kind, today))"
        },
        "me": {
          "from": "me",
          "desc": "내 이름(패널 설정의 myName)"
        }
      },
      "fields": {
        "docNo": {
          "type": "string",
          "required": true,
          "label": "문서번호",
          "desc": "그 문서의 번호",
          "read": "신청 내역에서 고른 문서번호 그대로. 지어내지 않습니다",
          "llm": true,
          "ui": true,
          "example": "202610-11115-0002",
          "max": 30
        },
        "formId": {
          "type": "enum",
          "required": true,
          "label": "신청서",
          "desc": "그 문서의 신청서 — TRO 외근/교육 · TR 출장 · ET 기타(외출) · LV 휴가/공가 · FW 유연근무",
          "read": "신청 내역 줄의 formId 그대로",
          "llm": true,
          "ui": true,
          "example": "TRO",
          "values": [
            "TRO",
            "TR",
            "ET",
            "LV",
            "FW"
          ]
        },
        "action": {
          "type": "enum",
          "required": true,
          "label": "무엇을",
          "desc": "request 상신(임시저장을 결재요청) · recall 회수(결재요청을 거둠) · delete 삭제(임시저장·회수한 문서)",
          "read": "상신하라면 request, 회수하라면 recall, 지우라면 delete",
          "llm": true,
          "ui": true,
          "example": "request",
          "values": [
            "request",
            "recall",
            "delete"
          ]
        }
      },
      "checks": [],
      "rules": [],
      "llm": false,
      "runner": "attend.doc",
      "uses": [
        {
          "module": "src/attend.js",
          "export": "buildDocJob"
        },
        {
          "module": "src/hr.js",
          "export": "hrRunJob"
        },
        {
          "module": "src/hr.js",
          "export": "hrDeleteDoc"
        }
      ],
      "then": [],
      "next": "보낸 뒤 confirmInList 로 목록을 다시 읽는다 — 삭제는 목록에서 사라져야 하고 상신·회수는 상태가 바뀌어야 한다(패널이 outcome 으로 판정)"
    },
    "attend.welfare": {
      "id": "attend.welfare",
      "domain": "attend",
      "kind": "welfare",
      "title": "가족 기념일 지원 신청 화면 채우기",
      "hint": "기념일 지원",
      "status": "planned",
      "confirm": true,
      "effect": "draft",
      "log": "attend",
      "summary": "기념일 지원 신청 화면 채우기",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — 날짜 칸의 기본값이고 \"내일\"·\"다음 주 수요일\" 셈의 기준(blankForm(kind, today))"
        },
        "me": {
          "from": "me",
          "desc": "내 이름(패널 설정의 myName)"
        }
      },
      "fields": {
        "form": {
          "type": "object",
          "required": true,
          "label": "연차 폼",
          "desc": "기념일 지원을 붙인 연차 폼(attend.leave 의 칸 그대로 — welfareFill 이 dateFrom·dateTo 와 wfa* 를 읽는다)",
          "read": "사용자가 정하지 않습니다 — 결재요청한 연차 폼이 그대로 들어갑니다",
          "llm": false,
          "ui": true,
          "from": "attend.leave",
          "omit": [
            "op",
            "doc"
          ],
          "fields": {
            "sub": {
              "type": "enum",
              "required": true,
              "label": "종류",
              "desc": "갈래 — LY(연차·반차)·LH(체력단련, HR 의 체력관리)",
              "read": "leave 이면 LY(연차·반차)·LH(체력단련)",
              "default": "LY",
              "example": "LY",
              "values": [
                "LY",
                "LH"
              ]
            },
            "dateFrom": {
              "type": "date",
              "required": true,
              "label": "시작일",
              "desc": "시작일(연차휴가 사용일의 첫날)",
              "read": "시작일(YYYY-MM-DD). \"내일\"·\"다음 주 수요일\" 은 오늘을 기준으로 실제 날짜로",
              "example": "2026-10-20"
            },
            "dateTo": {
              "type": "date",
              "required": true,
              "label": "종료일",
              "desc": "종료일 — 며칠간(days)에서 나온다(settle/tripDates). 달력으로 고르면 며칠간이 따라 바뀐다",
              "read": "여러 날 휴가의 종료일(YYYY-MM-DD). 하루면 null",
              "example": "2026-10-21"
            },
            "days": {
              "type": "integer",
              "required": true,
              "label": "며칠간",
              "desc": "며칠간(하루 1) — 칩 1D~5D(2026-10-02 사용자 지정), 그보다 길면 종료일 달력에서",
              "read": "며칠간인지(하루 1, 이틀이면 2). \"3일간\" 처럼 기간으로 말했을 때",
              "default": 1,
              "example": 2,
              "min": 1,
              "max": 31
            },
            "half": {
              "type": "enum",
              "label": "구분",
              "desc": "하루짜리 연차의 구분 — am(오전 반차)·pm(오후 반차)·전일(빈 값). 여러 날이거나 체력단련이면 전일로 잠긴다(locked)",
              "read": "하루짜리 연차의 구분. am(오전 반차)·pm(오후 반차)·full(전일). 휴가가 아니면 null",
              "example": "am",
              "values": [
                "am",
                "pm",
                "full"
              ]
            },
            "wfa": {
              "type": "boolean",
              "label": "기념일 지원",
              "desc": "가족 기념일(생일·결혼기념일·어린이날 …)에 쓰는 연차면 켠다 — 결재요청 뒤 eclass 의 가족 기념일 지원 신청 화면을 채워 연다(src/welfare.js). 연차(LY)에만 있다",
              "read": "연차를 가족 기념일(생일·결혼기념일·어린이날 …)에 쓰는가 — \"기념일\"·\"기념일 지원\" 이라고 말했을 때만 true. 그 밖에는 null",
              "when": "sub=LY",
              "default": false
            },
            "wfaReason": {
              "type": "enum",
              "required": true,
              "label": "신청사항",
              "desc": "신청사항(기념일의 종류)",
              "read": "어떤 기념일인지 — 목록의 이름 그대로",
              "when": "wfa",
              "values": [
                "생일(양력)",
                "결혼기념일",
                "자녀 입학식",
                "자녀 졸업식",
                "자녀 방학",
                "신정",
                "어린이날",
                "어버이날",
                "세계가정의날",
                "부부의날",
                "부처님오신날",
                "창립기념일",
                "노조 창립기념일",
                "추석",
                "크리스마스",
                "설날",
                "생일(음력)"
              ]
            },
            "wfaDate": {
              "type": "date",
              "required": true,
              "label": "기념일",
              "desc": "기념일 날짜",
              "read": "기념일(YYYY-MM-DD)",
              "when": "wfa"
            },
            "wfaName": {
              "type": "string",
              "required": true,
              "label": "대상자",
              "desc": "대상자(본인 또는 가족 이름)",
              "read": "기념일의 대상자 이름",
              "when": "wfa",
              "max": 50
            },
            "wfaRelation": {
              "type": "enum",
              "required": true,
              "label": "가족관계",
              "desc": "대상자와의 관계",
              "read": "대상자와의 관계 — 목록의 이름 그대로",
              "when": "wfa",
              "default": "본인",
              "values": [
                "본인",
                "배우자",
                "부모",
                "형제,자매",
                "자녀",
                "배우자 부모"
              ]
            },
            "wfaStayFrom": {
              "type": "date",
              "label": "시설 시작일",
              "desc": "시설 이용 시작일(숙박 등 — 없으면 비운다. 시작·종료를 같이 적는다)",
              "read": "시설을 이용했으면 그 시작일(YYYY-MM-DD)",
              "when": "wfa"
            },
            "wfaStayTo": {
              "type": "date",
              "label": "시설 종료일",
              "desc": "시설 이용 종료일",
              "read": "시설을 이용했으면 그 종료일(YYYY-MM-DD)",
              "when": "wfa"
            },
            "wfaPaid": {
              "type": "string",
              "label": "결제금액",
              "desc": "결제금액(원 — 영수증 금액. 쉼표·원은 걷는다 wonOf). 다녀온 뒤에야 알면 비워 두고 신청 화면에서 적는다",
              "read": "영수증의 결제 금액(숫자만)",
              "when": "wfa",
              "max": 20
            },
            "wfaAsk": {
              "type": "string",
              "label": "신청금액",
              "desc": "신청금액(원 — 이용일당 150,000 까지, src/welfare.js WFA_MAX). 결제금액을 넘을 수 없다",
              "read": "신청할 금액(숫자만, 150000 까지)",
              "when": "wfa",
              "max": 20
            },
            "wfaCash": {
              "type": "enum",
              "label": "사용구분",
              "desc": "결제 수단 — 1(현금영수증)·2(신용카드)·3(체크카드)",
              "read": "현금영수증이면 1, 신용카드면 2, 체크카드면 3",
              "when": "wfa",
              "values": [
                "1",
                "2",
                "3"
              ]
            }
          }
        }
      },
      "checks": [],
      "rules": [],
      "llm": false,
      "runner": "attend.welfare",
      "uses": [
        {
          "module": "src/welfare.js",
          "export": "welfareFill"
        }
      ],
      "then": [],
      "next": "새 탭에 신청 화면을 열고 칸을 채운다(pageFillWelfare — 못 채운 칸은 missed). 사람이 증빙을 붙이고 \"저장 및 상신\" 을 누른다"
    },
    "car.search": {
      "id": "car.search",
      "domain": "car",
      "kind": "search",
      "title": "차량 빈 시간 찾기",
      "hint": "업무용 차량",
      "status": "live",
      "confirm": false,
      "effect": "none",
      "log": "ask",
      "summary": "{summary}",
      "preset": {
        "me": {
          "from": "me",
          "desc": "내 이름(패널 설정의 myName — 내 신청 판정에 쓴다. 차량 신청 폼은 로그인한 사람의 이름을 내려 주므로 rememberName 이 채우기도 한다)"
        },
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — 날짜가 없으면 오늘 하루를 본다"
        }
      },
      "fields": {
        "dateFrom": {
          "type": "date",
          "required": true,
          "label": "조회 시작일",
          "desc": "조회 시작일",
          "read": "조회 시작일(YYYY-MM-DD). 날짜가 없으면 오늘",
          "llm": true,
          "ui": true,
          "example": "2026-10-20"
        },
        "dateTo": {
          "type": "date",
          "required": true,
          "label": "조회 종료일",
          "desc": "조회 종료일(포함)",
          "read": "조회 종료일(YYYY-MM-DD, 포함). 날짜가 하나면 시작일과 같은 날",
          "llm": true,
          "ui": true,
          "example": "2026-10-21"
        },
        "hourFrom": {
          "type": "integer",
          "required": true,
          "label": "조회 시작 시",
          "desc": "하루 중 조회 시작 시",
          "read": "하루 중 조회 시작 시(0~23). 시간대가 없으면 9",
          "llm": true,
          "ui": true,
          "example": 9,
          "min": 0,
          "max": 23
        },
        "hourTo": {
          "type": "integer",
          "required": true,
          "label": "조회 종료 시",
          "desc": "하루 중 조회 종료 시",
          "read": "하루 중 조회 종료 시(1~24). 시간대가 없으면 18",
          "llm": true,
          "ui": true,
          "example": 18,
          "min": 1,
          "max": 24
        },
        "minHours": {
          "type": "number",
          "label": "최소 시간",
          "desc": "연속으로 필요한 최소 시간",
          "read": "\"2시간짜리\" 처럼 필요한 길이가 나오면 그 시간. 없으면 null",
          "llm": true,
          "ui": true,
          "example": 2,
          "min": 0.5,
          "max": 24
        },
        "summary": {
          "type": "string",
          "required": true,
          "label": "요약",
          "desc": "해석한 조건을 한 줄로 요약(한국어)",
          "read": "사용자가 확인할 수 있게 해석 결과를 한 줄로(한국어)",
          "llm": true,
          "ui": true,
          "example": "10/20~21 2시간",
          "max": 200
        }
      },
      "drops": {
        "minSeats": "차량은 좌석 수를 알 수 없어 인원 조건은 뺐습니다",
        "region": "차량은 지역을 가리지 않아 지역 조건은 뺐습니다"
      },
      "checks": [
        {
          "left": "dateFrom",
          "op": "<=",
          "right": "dateTo",
          "message": "종료일이 시작일보다 앞섭니다"
        },
        {
          "left": "hourFrom",
          "op": "<",
          "right": "hourTo",
          "message": "종료 시가 시작 시보다 늦어야 합니다"
        }
      ],
      "rules": [
        "날짜가 없으면 오늘 하루만 조회합니다(dateFrom = dateTo = 오늘).",
        "\"내일\", \"이번 주\", \"다음 주\" 같은 표현은 오늘을 기준으로 실제 날짜로 바꿉니다.",
        "연도가 없으면 오늘과 같은 해로 봅니다.",
        "시간대가 없으면 hourFrom 9, hourTo 18 로 둡니다.",
        "차량에는 좌석 정보가 없으므로 minSeats 는 항상 null 입니다. 지역도 가리지 않으므로 region 은 항상 null 입니다.",
        "\"2시간짜리\" 처럼 필요한 길이가 나오면 minHours 에 넣습니다.",
        "summary 는 사용자가 확인할 수 있게 해석 결과를 한 줄로 적습니다."
      ],
      "llm": true,
      "task": "search.car",
      "runner": "booking.search",
      "uses": [
        {
          "module": "src/search.js",
          "export": "findSlots"
        }
      ],
      "then": [],
      "next": "후보를 화면에 보인다(renderFound) → 사용자가 누르면 그 탭·날짜로 옮겨 칸을 골라 두고(applyFound) 신청은 car.reserve 다"
    },
    "car.reserve": {
      "id": "car.reserve",
      "domain": "car",
      "kind": "reserve",
      "title": "차량 신청",
      "status": "live",
      "confirm": true,
      "effect": "write",
      "log": "reserve",
      "summary": "{car} {date} {start}~{end} · {place}",
      "preset": {
        "me": {
          "from": "me",
          "desc": "내 이름(패널 설정의 myName — 내 신청 판정에 쓴다. 차량 신청 폼은 로그인한 사람의 이름을 내려 주므로 rememberName 이 채우기도 한다)"
        }
      },
      "fields": {
        "car": {
          "type": "string",
          "required": true,
          "label": "차량",
          "desc": "차량 이름(사이트 목록의 이름)",
          "read": "조회 결과에서 고른 차량 이름 그대로. 지어내지 않습니다",
          "llm": true,
          "ui": true,
          "example": "카니발(12가 3456)",
          "max": 100
        },
        "carValue": {
          "type": "string",
          "required": true,
          "desc": "사이트의 차량 값(CARIDX)",
          "read": "조회 결과의 차량 값 그대로",
          "llm": false,
          "ui": true,
          "example": "7",
          "max": 50
        },
        "date": {
          "type": "date",
          "required": true,
          "label": "이용일",
          "desc": "이용일(시작일)",
          "read": "이용일(YYYY-MM-DD)",
          "llm": true,
          "ui": true,
          "example": "2026-10-20"
        },
        "start": {
          "type": "time",
          "required": true,
          "label": "시작",
          "desc": "시작 시각",
          "read": "시작 시각 HH:MM",
          "llm": true,
          "ui": true,
          "example": "09:00"
        },
        "end": {
          "type": "time",
          "required": true,
          "label": "종료",
          "desc": "종료 시각(여러 날이면 마지막 날의 반납 시각)",
          "read": "종료 시각 HH:MM",
          "llm": true,
          "ui": true,
          "example": "18:00"
        },
        "endDate": {
          "type": "date",
          "label": "반납일",
          "desc": "여러 날에 걸친 신청의 마지막 날(근태 폼의 여러 날 출장에서 넘어온 것). 이용일과 같으면 비운다",
          "read": "여러 날 쓰면 마지막 날(YYYY-MM-DD). 하루면 null",
          "llm": true,
          "ui": true,
          "example": "2026-10-21"
        },
        "title": {
          "type": "string",
          "label": "사용목적",
          "desc": "사용목적(사이트는 요구하지 않는다 — 비워도 된다)",
          "read": "사용자가 말한 사용목적. 지어내지 않습니다",
          "llm": true,
          "ui": true,
          "example": "출장",
          "max": 100
        },
        "place": {
          "type": "string",
          "required": true,
          "label": "행선지",
          "desc": "행선지 — 사이트가 반드시 요구한다(RUNNERS.car.missing). 근태 폼에서는 출장지(장소) 또는 외근의 carPlace",
          "read": "차량으로 갈 곳. 사용자가 말한 것만",
          "llm": true,
          "ui": true,
          "example": "대전 한국기계연구원",
          "max": 100
        },
        "passenger": {
          "type": "string",
          "label": "동승자",
          "desc": "동승자(비워도 된다)",
          "read": "함께 타는 사람. 말하지 않았으면 null",
          "llm": true,
          "ui": true,
          "max": 100
        }
      },
      "checks": [
        {
          "left": "date",
          "op": "<=",
          "right": "endDate",
          "message": "반납일이 이용일보다 앞섭니다"
        }
      ],
      "rules": [],
      "llm": false,
      "runner": "booking.reserve",
      "uses": [
        {
          "module": "src/runners.js",
          "export": "RUNNERS"
        }
      ],
      "then": [],
      "next": "실행기가 다시 조회해 확인된 것만 ok 다(ok && verified) — 그 뒤 '내가 넣음' 기록과 내 이름(차량 폼이 내려 주는 who.name)은 패널이 남긴다. 실패하면 diagnose 작업이 원인을 읽는다"
    },
    "car.cancel": {
      "id": "car.cancel",
      "domain": "car",
      "kind": "cancel",
      "title": "차량 신청 취소",
      "status": "live",
      "confirm": true,
      "effect": "write",
      "log": "cancel",
      "summary": "{car} {date} {start}~{end}",
      "preset": {
        "me": {
          "from": "me",
          "desc": "내 이름(패널 설정의 myName — 내 신청 판정에 쓴다. 차량 신청 폼은 로그인한 사람의 이름을 내려 주므로 rememberName 이 채우기도 한다)"
        }
      },
      "fields": {
        "car": {
          "type": "string",
          "required": true,
          "label": "차량",
          "desc": "차량 이름",
          "read": "취소할 신청의 차량 이름 그대로",
          "llm": true,
          "ui": true,
          "example": "카니발(12가 3456)",
          "max": 100
        },
        "date": {
          "type": "date",
          "required": true,
          "label": "이용일",
          "desc": "이용일(시작일)",
          "read": "취소할 신청의 이용일(YYYY-MM-DD)",
          "llm": true,
          "ui": true,
          "example": "2026-10-20"
        },
        "start": {
          "type": "time",
          "required": true,
          "label": "시작",
          "desc": "시작 시각",
          "read": "취소할 신청의 시작 시각 HH:MM",
          "llm": true,
          "ui": true,
          "example": "09:00"
        },
        "end": {
          "type": "time",
          "required": true,
          "label": "종료",
          "desc": "종료 시각",
          "read": "취소할 신청의 종료 시각 HH:MM",
          "llm": true,
          "ui": true,
          "example": "18:00"
        },
        "endDate": {
          "type": "date",
          "label": "반납일",
          "desc": "여러 날에 걸친 신청의 마지막 날. 하루면 비운다",
          "read": "여러 날 신청이면 마지막 날(YYYY-MM-DD). 하루면 null",
          "llm": true,
          "ui": true
        },
        "title": {
          "type": "string",
          "label": "사용목적",
          "desc": "그 신청의 사용목적(기록용)",
          "read": "그 신청의 사용목적. 모르면 null",
          "llm": true,
          "ui": true,
          "max": 100
        },
        "place": {
          "type": "string",
          "label": "행선지",
          "desc": "그 신청의 행선지(기록용)",
          "read": "그 신청의 행선지. 모르면 null",
          "llm": true,
          "ui": true,
          "max": 100
        }
      },
      "checks": [
        {
          "left": "date",
          "op": "<=",
          "right": "endDate",
          "message": "반납일이 이용일보다 앞섭니다"
        }
      ],
      "rules": [],
      "llm": false,
      "runner": "booking.cancel",
      "uses": [
        {
          "module": "src/runners.js",
          "export": "RUNNERS"
        }
      ],
      "then": [],
      "next": "지운 뒤 걸친 날을 모두 다시 읽는다(forgetDays → load). 내 예약 목록에서 지웠으면 justBooked 에서도 뺀다(패널)"
    },
    "car.modify": {
      "id": "car.modify",
      "domain": "car",
      "kind": "modify",
      "title": "차량 신청 수정",
      "status": "live",
      "confirm": true,
      "effect": "write",
      "log": "modify",
      "preset": {
        "me": {
          "from": "me",
          "desc": "내 이름(패널 설정의 myName — 내 신청 판정에 쓴다. 차량 신청 폼은 로그인한 사람의 이름을 내려 주므로 rememberName 이 채우기도 한다)"
        }
      },
      "fields": {
        "back": {
          "type": "object",
          "required": true,
          "label": "원래 신청",
          "desc": "되돌릴 원래 신청(원래 차량·날짜·시간·행선지 — 취소 뒤 새 신청이 안 되면 이것으로 되살린다)",
          "read": "지금 잡혀 있는 신청 그대로(조회 결과에서). 지어내지 않습니다",
          "llm": false,
          "ui": true,
          "from": "car.reserve",
          "fields": {
            "car": {
              "type": "string",
              "required": true,
              "label": "차량",
              "desc": "차량 이름(사이트 목록의 이름)",
              "read": "조회 결과에서 고른 차량 이름 그대로. 지어내지 않습니다",
              "example": "카니발(12가 3456)",
              "max": 100
            },
            "carValue": {
              "type": "string",
              "required": true,
              "desc": "사이트의 차량 값(CARIDX)",
              "read": "조회 결과의 차량 값 그대로",
              "example": "7",
              "max": 50
            },
            "date": {
              "type": "date",
              "required": true,
              "label": "이용일",
              "desc": "이용일(시작일)",
              "read": "이용일(YYYY-MM-DD)",
              "example": "2026-10-20"
            },
            "start": {
              "type": "time",
              "required": true,
              "label": "시작",
              "desc": "시작 시각",
              "read": "시작 시각 HH:MM",
              "example": "09:00"
            },
            "end": {
              "type": "time",
              "required": true,
              "label": "종료",
              "desc": "종료 시각(여러 날이면 마지막 날의 반납 시각)",
              "read": "종료 시각 HH:MM",
              "example": "18:00"
            },
            "endDate": {
              "type": "date",
              "label": "반납일",
              "desc": "여러 날에 걸친 신청의 마지막 날(근태 폼의 여러 날 출장에서 넘어온 것). 이용일과 같으면 비운다",
              "read": "여러 날 쓰면 마지막 날(YYYY-MM-DD). 하루면 null",
              "example": "2026-10-21"
            },
            "title": {
              "type": "string",
              "label": "사용목적",
              "desc": "사용목적(사이트는 요구하지 않는다 — 비워도 된다)",
              "read": "사용자가 말한 사용목적. 지어내지 않습니다",
              "example": "출장",
              "max": 100
            },
            "place": {
              "type": "string",
              "required": true,
              "label": "행선지",
              "desc": "행선지 — 사이트가 반드시 요구한다(RUNNERS.car.missing). 근태 폼에서는 출장지(장소) 또는 외근의 carPlace",
              "read": "차량으로 갈 곳. 사용자가 말한 것만",
              "example": "대전 한국기계연구원",
              "max": 100
            },
            "passenger": {
              "type": "string",
              "label": "동승자",
              "desc": "동승자(비워도 된다)",
              "read": "함께 타는 사람. 말하지 않았으면 null",
              "max": 100
            }
          }
        },
        "next": {
          "type": "object",
          "required": true,
          "label": "새 조건",
          "desc": "새 조건(격자에서 고른 칸·행선지 — pickToPayload)",
          "read": "사용자가 바꾸라고 한 차량·날짜·시간·행선지",
          "llm": false,
          "ui": true,
          "from": "car.reserve",
          "fields": {
            "car": {
              "type": "string",
              "required": true,
              "label": "차량",
              "desc": "차량 이름(사이트 목록의 이름)",
              "read": "조회 결과에서 고른 차량 이름 그대로. 지어내지 않습니다",
              "example": "카니발(12가 3456)",
              "max": 100
            },
            "carValue": {
              "type": "string",
              "required": true,
              "desc": "사이트의 차량 값(CARIDX)",
              "read": "조회 결과의 차량 값 그대로",
              "example": "7",
              "max": 50
            },
            "date": {
              "type": "date",
              "required": true,
              "label": "이용일",
              "desc": "이용일(시작일)",
              "read": "이용일(YYYY-MM-DD)",
              "example": "2026-10-20"
            },
            "start": {
              "type": "time",
              "required": true,
              "label": "시작",
              "desc": "시작 시각",
              "read": "시작 시각 HH:MM",
              "example": "09:00"
            },
            "end": {
              "type": "time",
              "required": true,
              "label": "종료",
              "desc": "종료 시각(여러 날이면 마지막 날의 반납 시각)",
              "read": "종료 시각 HH:MM",
              "example": "18:00"
            },
            "endDate": {
              "type": "date",
              "label": "반납일",
              "desc": "여러 날에 걸친 신청의 마지막 날(근태 폼의 여러 날 출장에서 넘어온 것). 이용일과 같으면 비운다",
              "read": "여러 날 쓰면 마지막 날(YYYY-MM-DD). 하루면 null",
              "example": "2026-10-21"
            },
            "title": {
              "type": "string",
              "label": "사용목적",
              "desc": "사용목적(사이트는 요구하지 않는다 — 비워도 된다)",
              "read": "사용자가 말한 사용목적. 지어내지 않습니다",
              "example": "출장",
              "max": 100
            },
            "place": {
              "type": "string",
              "required": true,
              "label": "행선지",
              "desc": "행선지 — 사이트가 반드시 요구한다(RUNNERS.car.missing). 근태 폼에서는 출장지(장소) 또는 외근의 carPlace",
              "read": "차량으로 갈 곳. 사용자가 말한 것만",
              "example": "대전 한국기계연구원",
              "max": 100
            },
            "passenger": {
              "type": "string",
              "label": "동승자",
              "desc": "동승자(비워도 된다)",
              "read": "함께 타는 사람. 말하지 않았으면 null",
              "max": 100
            }
          }
        }
      },
      "checks": [],
      "rules": [],
      "llm": false,
      "runner": "booking.modify",
      "uses": [
        {
          "module": "src/modify.js",
          "export": "modifyReservation"
        },
        {
          "module": "src/runners.js",
          "export": "RUNNERS"
        }
      ],
      "then": [],
      "next": "결과(ok·stage·restored·lost·uncertain)는 modifyReservation 의 것 그대로다 — describeModifyResult 가 상태줄 문장을 만든다(패널)"
    },
    "circulate.run": {
      "id": "circulate.run",
      "domain": "circulate",
      "kind": "run",
      "title": "미회람 문서 열람",
      "status": "planned",
      "confirm": false,
      "effect": "write",
      "log": "circulate",
      "summary": "미회람 문서 열람",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — 하루에 한 번의 기준(docCirculateState 의 date)"
        },
        "enabled": {
          "from": "storage:docCirculate",
          "type": "boolean",
          "desc": "쓸지 — 패널의 \"설정 → 일반\" 체크박스(켠다고 한 적이 없으면 끈 것). 거짓이면 어댑터가 돌지 않는다(skipped off)"
        }
      },
      "fields": {
        "force": {
          "type": "boolean",
          "label": "오늘 했어도 다시",
          "desc": "오늘 끝낸 기록이 있어도 다시 돈다(설정을 방금 켰을 때 — startCirculate 의 kick(true))",
          "read": "다시 돌라고 했을 때만 true",
          "llm": true,
          "ui": true
        }
      },
      "checks": [],
      "rules": [],
      "llm": false,
      "runner": "circulate.run",
      "uses": [
        {
          "module": "src/circulate.js",
          "export": "runDaily"
        },
        {
          "module": "src/circulate.js",
          "export": "circulateAll"
        },
        {
          "module": "src/circulate.js",
          "export": "describeResult"
        }
      ],
      "then": [],
      "next": "결과를 활동 로그(circulate — 열 것이 없던 날이 이어지면 같은 줄을 쌓지 않는다)와 상태(docCirculateState — date·state·text·total·opened·remaining)에 적는다. 패널의 설정 화면이 상태를 보인다"
    },
    "gongmun.purchase": {
      "id": "gongmun.purchase",
      "domain": "gongmun",
      "kind": "purchase",
      "title": "구매품의 작성",
      "status": "live",
      "confirm": true,
      "effect": "write",
      "log": "gongmun",
      "summary": "{preset.kindTitle} · {title}",
      "preset": {
        "me": {
          "from": "me",
          "desc": "기안자(내 이름 — 결재선의 기안, 과제책임자가 본인이면 합의를 뺀다)",
          "required": true
        },
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — writePlan 의 ctx.today(첨부 이름·본문 날짜 자리)"
        },
        "setup": {
          "from": "storage:gongmunPreset",
          "type": "object",
          "desc": "공문 설정(부서·부서장·소장·본부장·문서번호 부서 — 실명은 여기에만 둔다). 어댑터가 writePlan 의 ctx.preset 으로 그대로 넘긴다 — 문서번호·결재선이 여기서 나온다",
          "required": true
        },
        "project": {
          "from": "ctx:project",
          "type": "object",
          "desc": "고른 과제(이름·별명·번호·Job Id(과제 찾기)·책임자·연구기간·개요·내용·계정·공문 참조자 refs·rnd.year — 공문 탭이 R&D 탭의 과제에서 고른 것. 과제 내용 3000자가 들어 있어 로그에서 뺀다)",
          "log": false
        },
        "kindTitle": {
          "from": "recipe:purposes.purchase.title",
          "desc": "갈래 이름(레시피 purpose.yaml 의 title — 구매품의) — 활동 로그 한 줄에 쓴다"
        }
      },
      "fields": {
        "form": {
          "type": "string",
          "required": true,
          "label": "양식",
          "desc": "eclass 전자결재 양식 ID(src/gongmun.js formsFor(종류) — 연구업무추진품의 KR_EA_Research_Task 가 기본, 기안문 KR_EA_Form2 는 본문만 있는 양식, 외부활동만 외부강의등 신고서). 목록에 없는 ID 를 직접 적으면 칸 지도가 없어 새 공문 창을 열기만 한다. 외부활동·구매의뢰는 종류 파일이 통째로 적는다(신고서·구매요청서가 기본)",
          "read": "품의 양식 — 연구업무추진품의(KR_EA_Research_Task)가 기본. 기안문이라고 했을 때만 KR_EA_Form2",
          "llm": true,
          "ui": true,
          "default": "KR_EA_Research_Task",
          "max": 60
        },
        "title": {
          "type": "string",
          "required": true,
          "label": "제목",
          "desc": "공문 제목(레시피 body_spec.yaml 의 제목 틀 — \"{품목요지} 구매 품의\"·\"{과제별명} 수행을 위한 {교육구분} 품의\"·\"… 출장 품의\"·신고서는 \"외부강의등 신고서\" — 을 채운 글. 전자결재가 99자에서 자른다. 사람이 고쳤으면 그 글)",
          "read": "제목 틀을 채운 제목. 사용자가 제목을 말했으면 그것",
          "llm": true,
          "ui": true,
          "max": 99
        },
        "body": {
          "type": "string",
          "required": true,
          "label": "본문",
          "desc": "본문(레시피 body_spec.yaml 의 본문 틀을 채운 글 — src/gongmun.js compose. 사람이 고쳤으면 그 글). 긴 줄표는 어댑터 쪽 writePlan 이 '-' 로 바꾼다(eclassText). 칸이 정해진 폼(외부강의등 신고서·구매요청서 — 그 종류 파일이 when 으로 뺀다)에서는 넣을 칸의 미리보기다",
          "read": "본문 틀을 채운 글",
          "llm": false,
          "ui": true,
          "max": 20000
        },
        "draft": {
          "type": "object",
          "label": "초안",
          "desc": "초안 칸(레시피 purpose.yaml 의 fields·reads — 생성기가 펼친다). 읽은 문서(gongmun.purchase)와 과제 내용으로 쓴 사유(gongmunReason.purchase)가 채우고 사람이 고친다",
          "read": "읽은 문서와 과제 내용으로 채운 초안",
          "llm": true,
          "ui": true,
          "from": "recipe",
          "fields": {
            "gist": {
              "type": "string",
              "label": "품목 요지 (제목)",
              "desc": "품목 요지 (제목)",
              "read": "공문 제목에 들어갈 짧은 품목 이름. 대표 품목을 짧게 적고(모델 번호는 빼도 됩니다), 품목이 둘 이상이면 \"대표 품목 외 N건\" 으로 적습니다.",
              "example": "34인치 모니터 외 1건",
              "max": 200
            },
            "vendor": {
              "type": "string",
              "label": "구매처",
              "desc": "구매처",
              "read": "견적을 낸 업체·판매처 — 상호 그대로. 쇼핑몰 화면이면 판매자이고, 판매자가 없으면 쇼핑몰 이름입니다.",
              "example": "(주)OO상사",
              "max": 200
            },
            "total": {
              "type": "number",
              "label": "합계 (VAT 포함, 원)",
              "desc": "합계 (VAT 포함, 원)",
              "read": "부가세를 포함한 최종 합계(결제·청구할 금액). 할인이 있으면 할인을 뺀 금액입니다. 문서에 \"부가세 별도\" 이고 합계가 공급가액뿐이면 null 로 두고 supply 에 적습니다 — 셈해 넣지 않습니다.",
              "example": 989000,
              "min": 0
            },
            "use": {
              "type": "string",
              "label": "용도",
              "desc": "용도",
              "read": "공문 용도 칸의 초안 — 품목의 쓰임을 짧은 구절로. 문서에 적혀 있으면 그대로, 없으면 품목으로 보아 연구부서에서 흔히 쓰는 쓰임을 적습니다 (사용자가 고칩니다). 사유는 여기서 쓰지 않습니다.",
              "example": "연구 데이터 저장·백업용",
              "max": 200
            },
            "reason": {
              "type": "string",
              "label": "구매사유",
              "desc": "구매사유",
              "read": "구매사유 칸",
              "example": "과제의 MVDC 차단기 시험 데이터 저장·분석에 필요함",
              "max": 1000
            },
            "summary": {
              "type": "string",
              "label": "요약 (2. 이와 관련하여 …)",
              "desc": "요약 (2. 이와 관련하여 …)",
              "read": "요약 (2. 이와 관련하여 …) 칸",
              "max": 200
            },
            "account": {
              "type": "string",
              "label": "구매계정",
              "desc": "구매계정",
              "read": "구매계정 칸",
              "max": 200
            },
            "items": {
              "type": "list",
              "desc": "품목. 문서의 품목 표를 적힌 차례대로 한 줄씩 옮깁니다. 배송비·설치비처럼 따로 적힌 줄도 품목으로 넣습니다.",
              "read": "품목. 문서의 품목 표를 적힌 차례대로 한 줄씩 옮깁니다. 배송비·설치비처럼 따로 적힌 줄도 품목으로 넣습니다.",
              "max": 30,
              "item": {
                "name": {
                  "type": "string",
                  "required": true,
                  "desc": "품목명·모델명 — 문서에 적힌 그대로(요약하지 않습니다)",
                  "read": "품목명·모델명 — 문서에 적힌 그대로(요약하지 않습니다)",
                  "example": "LG 34WQ75C 34인치 모니터",
                  "max": 200
                },
                "spec": {
                  "type": "string",
                  "desc": "규격·사양 — 문서에 적힌 핵심을 ' · ' 로 나열",
                  "read": "규격·사양 — 문서에 적힌 핵심을 ' · ' 로 나열",
                  "example": "WQHD · 커브드 · USB-C",
                  "max": 300
                },
                "qty": {
                  "type": "number",
                  "desc": "수량",
                  "read": "수량",
                  "example": 1,
                  "min": 0
                },
                "unit": {
                  "type": "string",
                  "desc": "단위(개·대·EA·식 등)",
                  "read": "단위(개·대·EA·식 등)",
                  "example": "대",
                  "max": 10
                },
                "unitPrice": {
                  "type": "number",
                  "desc": "단가",
                  "read": "단가",
                  "example": 890000,
                  "min": 0
                },
                "amount": {
                  "type": "number",
                  "desc": "그 줄의 금액 — 문서에 적힌 그대로",
                  "read": "그 줄의 금액 — 문서에 적힌 그대로",
                  "example": 890000,
                  "min": 0
                }
              }
            },
            "quoteDate": {
              "type": "date",
              "desc": "견적일·발행일·주문일. 쇼핑몰 화면이면 주문일이고, 주문 전 장바구니·상품 화면이면 null 입니다.",
              "read": "견적일·발행일·주문일. 쇼핑몰 화면이면 주문일이고, 주문 전 장바구니·상품 화면이면 null 입니다.",
              "example": "2026-10-01"
            },
            "supply": {
              "type": "number",
              "desc": "공급가액 합계(부가세를 뺀 금액) — 문서에 따로 적혀 있을 때만",
              "read": "공급가액 합계(부가세를 뺀 금액) — 문서에 따로 적혀 있을 때만",
              "example": 899091,
              "min": 0
            },
            "vat": {
              "type": "number",
              "desc": "부가세 합계 — 문서에 따로 적혀 있을 때만",
              "read": "부가세 합계 — 문서에 따로 적혀 있을 때만",
              "example": 89909,
              "min": 0
            },
            "currency": {
              "type": "enum",
              "label": "화폐",
              "desc": "합계의 화폐 — 원화가 아니면 합계를 원화로 고쳐 적는다(src/gongmun.js fromRecord 의 알림)",
              "read": "문서의 화폐(ISO 세 글자 코드). 원화 문서면 KRW",
              "default": "KRW",
              "values": [
                "KRW",
                "USD",
                "EUR",
                "JPY",
                "CNY",
                "GBP"
              ]
            },
            "attach": {
              "type": "list",
              "label": "첨부",
              "desc": "첨부 목록 — 문서 이름마다 그 문서로 묶는 파일 이름들(src/gongmun.js attachList — 레시피 attach_rules.yaml 의 parts)",
              "read": "첨부 문서마다 이름과 그 문서로 묶는 파일 이름들",
              "max": 20,
              "item": {
                "label": {
                  "type": "string",
                  "required": true,
                  "desc": "첨부 목록의 문서 이름(견적서·교육 안내 …)",
                  "read": "첨부 목록에 적는 문서 이름",
                  "max": 100
                },
                "files": {
                  "type": "tags",
                  "desc": "그 문서로 묶는 파일 이름들(자유 글의 목록 — values 없음)",
                  "read": "그 문서로 묶는 파일 이름들. 모르면 빈 목록"
                }
              }
            }
          }
        },
        "rank": {
          "type": "enum",
          "label": "전결권자",
          "desc": "이 공문에서 사람이 고른 전결권자 직책(registries/delegation.yaml 의 ranks). 비면 규정대로(레시피 purpose.yaml 의 rule_key — 구매·구매의뢰·교육은 연구비집행 금액 구간, 출장은 국내·해외, 외부활동은 팀장). 고르면 그것이 이긴다(delegationOf 의 overridden)",
          "read": "사용자가 전결권자(팀장·소장·본부장)를 말했을 때만. 그 밖에는 null(규정대로)",
          "llm": true,
          "ui": true,
          "values": [
            "팀장",
            "소장",
            "본부장"
          ]
        },
        "lead": {
          "type": "string",
          "label": "과제 책임자",
          "desc": "합의자 — 고른 과제의 책임자(R&D 탭 과제 정보). 기안자(preset.me) 본인이면 합의를 넣지 않는다",
          "read": "과제 책임자 이름",
          "llm": false,
          "ui": true,
          "max": 40
        },
        "refs": {
          "type": "tags",
          "label": "참조자",
          "desc": "결재선의 참조자 — R&D 탭 참여인력에서 공문 참조를 켠 사람과 계획서 YAML 의 공문.참조자.<갈래>(구매·교육·출장). 결재선에 이미 선 사람은 뺀다. 빈 목록이면 참조 없음",
          "read": "참조자 이름들",
          "llm": false,
          "ui": true
        },
        "setting": {
          "type": "object",
          "label": "문서설정",
          "desc": "이 공문에서 바꾼 문서설정만(없는 키는 레시피 프로파일·공문 설정대로 — docSettingOf). 전자결재 툴바의 '문서설정' 창에 넣는 값이다",
          "read": "사용자가 문서설정(보존년한·수신처·공개범위·긴급·검색 키워드 등)을 바꾸라고 했을 때만",
          "llm": false,
          "ui": true,
          "fields": {
            "retention": {
              "type": "enum",
              "desc": "보존년한 코드(1년·2년·3년·5년·10년·20년·영구 — settings.yaml options.retention. 품의는 10년, 신고서·구매요청서는 3년이 기본)",
              "read": "보존년한을 말했으면 그 코드(10년이면 120, 3년이면 36)",
              "values": [
                "12",
                "24",
                "36",
                "60",
                "120",
                "240",
                "1200"
              ]
            },
            "docNo": {
              "type": "string",
              "desc": "문서번호 부서 코드(Doc No. — ddlDocNo 의 값, 숫자만)",
              "read": "문서번호 부서를 코드로 말했을 때만",
              "max": 8
            },
            "receiver": {
              "type": "enum",
              "desc": "수신처(settings.yaml options.receiver — 부서는 receivers 의 코드로 SetReceiverValue. 구매요청서는 프로파일이 총무팀)",
              "read": "수신처를 말했을 때만 — 내부결재·KRE·총무팀",
              "values": [
                "내부결재",
                "KRE",
                "총무팀"
              ]
            },
            "scope": {
              "type": "enum",
              "desc": "공개범위(settings.yaml options.scope — 결재선 YNN·기안부서 NNY)",
              "read": "공개범위를 말했을 때만 — 결재선 또는 기안부서",
              "values": [
                "결재선",
                "기안부서"
              ]
            },
            "emergency": {
              "type": "boolean",
              "desc": "긴급",
              "read": "긴급이라고 했을 때만 true"
            },
            "approvingOpen": {
              "type": "boolean",
              "desc": "진행공개",
              "read": "진행공개라고 했을 때만 true"
            },
            "drm": {
              "type": "boolean",
              "desc": "DRM",
              "read": "DRM 을 걸라고 했을 때만 true"
            },
            "tag": {
              "type": "string",
              "desc": "검색 키워드(비면 프로파일대로 — 구매·구매의뢰·교육은 고른 과제의 별명, 출장은 '출장', 외부활동은 '외부활동'. 2026-10-12 사용자 지정 \"연구개발 별칭이 있다면 그걸 넣어줘, 외부활동이면 외부활동, 출장이면 출장\")",
              "read": "검색 키워드를 말했을 때만",
              "max": 60
            }
          }
        },
        "attach": {
          "type": "list",
          "label": "첨부",
          "desc": "첨부 파일 이름(바이트는 ctx.files — 이름으로 잇는다). 읽은 문서를 첨부 목록의 문서마다 PDF 로 묶은 것과 원본 첨부. 견적서를 오렸으면(cut) 오린 그림이 앞에 온다",
          "read": "첨부할 문서의 파일 이름 목록. 지어내지 않습니다",
          "llm": false,
          "ui": true,
          "max": 5,
          "item": {
            "name": {
              "type": "string",
              "required": true,
              "desc": "파일 이름(견적서_업체_날짜.pdf 처럼 attachName 이 지은 것이거나 원본 이름)",
              "read": "파일 이름",
              "max": 200
            },
            "kind": {
              "type": "string",
              "desc": "무엇의 문서인지(첨부 목록의 문서 이름 — 견적서·거래명세서·교육 내용·행사 안내문·요청 공문 …, 원본 첨부면 original)",
              "read": "무엇의 문서인지. 모르면 null",
              "max": 40
            }
          }
        }
      },
      "checks": [],
      "rules": [],
      "llm": {
        "tasks": [
          {
            "task": "gongmun.purchase",
            "fills": "draft"
          },
          {
            "task": "gongmunReason.purchase",
            "fills": "draft"
          }
        ]
      },
      "runner": "gongmun.write",
      "uses": [
        {
          "module": "src/gongmun.js",
          "export": "writePlan"
        },
        {
          "module": "src/gmwrite.js",
          "export": "writeGongmun"
        }
      ],
      "then": [],
      "next": "뒤 탭에 공문을 쓴다(과제·제목·차수·본문·문서설정·결재선·첨부 — 단계마다 onStep). ok 는 steps 에 ok false 가 없을 때다(§14.3). 임시저장·상신은 사람이 창에서 한다 — 패널은 읽어 둔 공문 이력을 묵은 것으로 두어 다음에 다시 읽는다"
    },
    "gongmun.edu": {
      "id": "gongmun.edu",
      "domain": "gongmun",
      "kind": "edu",
      "title": "교육품의 작성",
      "status": "live",
      "confirm": true,
      "effect": "write",
      "log": "gongmun",
      "summary": "{preset.kindTitle} · {title}",
      "preset": {
        "me": {
          "from": "me",
          "desc": "기안자(내 이름 — 결재선의 기안, 과제책임자가 본인이면 합의를 뺀다)",
          "required": true
        },
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — writePlan 의 ctx.today(첨부 이름·본문 날짜 자리)"
        },
        "setup": {
          "from": "storage:gongmunPreset",
          "type": "object",
          "desc": "공문 설정(부서·부서장·소장·본부장·문서번호 부서 — 실명은 여기에만 둔다). 어댑터가 writePlan 의 ctx.preset 으로 그대로 넘긴다 — 문서번호·결재선이 여기서 나온다",
          "required": true
        },
        "project": {
          "from": "ctx:project",
          "type": "object",
          "desc": "고른 과제(이름·별명·번호·Job Id(과제 찾기)·책임자·연구기간·개요·내용·계정·공문 참조자 refs·rnd.year). 별명이 제목에 들어간다. 과제 내용 3000자가 들어 있어 로그에서 뺀다",
          "log": false
        },
        "kindTitle": {
          "from": "recipe:purposes.edu.title",
          "desc": "갈래 이름(레시피 purpose.yaml 의 title — 교육품의) — 활동 로그 한 줄에 쓴다"
        }
      },
      "fields": {
        "form": {
          "type": "string",
          "required": true,
          "label": "양식",
          "desc": "eclass 전자결재 양식 ID(src/gongmun.js formsFor(종류) — 연구업무추진품의 KR_EA_Research_Task 가 기본, 기안문 KR_EA_Form2 는 본문만 있는 양식, 외부활동만 외부강의등 신고서). 목록에 없는 ID 를 직접 적으면 칸 지도가 없어 새 공문 창을 열기만 한다. 외부활동·구매의뢰는 종류 파일이 통째로 적는다(신고서·구매요청서가 기본)",
          "read": "품의 양식 — 연구업무추진품의(KR_EA_Research_Task)가 기본. 기안문이라고 했을 때만 KR_EA_Form2",
          "llm": true,
          "ui": true,
          "default": "KR_EA_Research_Task",
          "max": 60
        },
        "title": {
          "type": "string",
          "required": true,
          "label": "제목",
          "desc": "공문 제목(레시피 body_spec.yaml 의 제목 틀 — \"{품목요지} 구매 품의\"·\"{과제별명} 수행을 위한 {교육구분} 품의\"·\"… 출장 품의\"·신고서는 \"외부강의등 신고서\" — 을 채운 글. 전자결재가 99자에서 자른다. 사람이 고쳤으면 그 글)",
          "read": "제목 틀을 채운 제목. 사용자가 제목을 말했으면 그것",
          "llm": true,
          "ui": true,
          "max": 99
        },
        "body": {
          "type": "string",
          "required": true,
          "label": "본문",
          "desc": "본문(레시피 body_spec.yaml 의 본문 틀을 채운 글 — src/gongmun.js compose. 사람이 고쳤으면 그 글). 긴 줄표는 어댑터 쪽 writePlan 이 '-' 로 바꾼다(eclassText). 칸이 정해진 폼(외부강의등 신고서·구매요청서 — 그 종류 파일이 when 으로 뺀다)에서는 넣을 칸의 미리보기다",
          "read": "본문 틀을 채운 글",
          "llm": false,
          "ui": true,
          "max": 20000
        },
        "draft": {
          "type": "object",
          "label": "초안",
          "desc": "초안 칸(레시피 purpose.yaml 의 fields·reads — 생성기가 펼친다). 읽은 문서(gongmun.edu)와 과제 내용으로 쓴 사유(gongmunReason.edu)가 채우고 사람이 고친다",
          "read": "읽은 문서와 과제 내용으로 채운 초안",
          "llm": true,
          "ui": true,
          "from": "recipe",
          "fields": {
            "course": {
              "type": "string",
              "label": "교육명",
              "desc": "교육명",
              "read": "교육 과정의 이름 — 안내문·신청 확인서·견적서에 적힌 그대로(회차·기수 표시도 그대로).",
              "example": "전력변환 설계 실무(3기)",
              "max": 200
            },
            "provider": {
              "type": "string",
              "label": "교육기관",
              "desc": "교육기관",
              "read": "교육을 여는 기관·업체 — 상호 그대로. 온라인 강의면 강의 플랫폼 이름입니다.",
              "example": "한국전력기술교육원",
              "max": 200
            },
            "fee": {
              "type": "number",
              "label": "교육비 (VAT 포함, 원)",
              "desc": "교육비 (VAT 포함, 원)",
              "read": "부가세를 포함해 실제로 낼 교육비 — 할인을 뺀 결제 금액. \"부가세 별도\" 이고 공급가액만 있으면 null 로 두고 supply 에 적습니다 — 셈해 넣지 않습니다.",
              "example": 450000,
              "min": 0
            },
            "from": {
              "type": "date",
              "label": "시작일",
              "desc": "시작일",
              "read": "교육이 실제로 열리는 첫날. 신청 마감일·결제일·수강 가능 기한(\"수강기한 90일\")과 헷갈리지 않습니다. 연도가 적혀 있지 않으면 문서 발행일(없으면 오늘)의 연도를 붙입니다. 날짜 없이 언제든 듣는 온라인 강의면 null 입니다.",
              "example": "2026-11-03"
            },
            "to": {
              "type": "date",
              "label": "종료일",
              "desc": "종료일",
              "read": "교육의 마지막 날. 하루짜리 교육이면 시작일과 같은 날입니다.",
              "example": "2026-11-05"
            },
            "place": {
              "type": "string",
              "label": "교육장소",
              "desc": "교육장소",
              "read": "교육이 열리는 곳 — 도시와 기관·강의실. 온라인 강의면 \"온라인\", 실시간 화상 교육이면 \"온라인(Zoom)\" 처럼 적습니다.",
              "example": "대전 한국전력기술교육원",
              "max": 200
            },
            "mode": {
              "type": "enum",
              "label": "교육 구분 (제목)",
              "desc": "교육 구분 (제목)",
              "read": "교육 구분 (제목) 칸",
              "values": [
                "교육",
                "온라인교육"
              ]
            },
            "hours": {
              "type": "string",
              "label": "교육시간",
              "desc": "교육시간",
              "read": "교육 시간 — 총 시간과 하루 시간표를 적힌 대로. 온라인 강의면 총 재생 시간이나 수업 수입니다.",
              "example": "3일 21시간(09:00~17:00)",
              "max": 200
            },
            "topics": {
              "type": "string",
              "label": "교육내용",
              "desc": "교육내용",
              "read": "교육 내용 — 커리큘럼·주요 강의 주제를 \" · \" 로 나열합니다. 교육 내용(커리큘럼) 캡처가 함께 왔으면 그 장을 보고 적습니다.",
              "example": "DC-DC 컨버터 설계 · 제어 루프 설계 · 시뮬레이션 실습",
              "max": 400
            },
            "attendees": {
              "type": "string",
              "label": "참석자",
              "desc": "참석자",
              "read": "참석자 칸",
              "max": 200
            },
            "purpose": {
              "type": "string",
              "label": "교육목적",
              "desc": "교육목적",
              "read": "교육으로 무엇의 역량을 기르는지 짧은 구절로. 문서에 적혀 있으면 그대로, 없으면 교육 내용으로 보아 적습니다(사용자가 고칩니다).",
              "example": "전력변환 회로 설계 역량 강화",
              "max": 200
            },
            "reason": {
              "type": "string",
              "label": "교육사유",
              "desc": "교육사유",
              "read": "교육사유 칸",
              "example": "과제의 MVDC 전력변환기 설계 역량 확보에 필요함",
              "max": 1000
            },
            "account": {
              "type": "string",
              "label": "예산계정",
              "desc": "예산계정",
              "read": "예산계정 칸",
              "max": 200
            },
            "supply": {
              "type": "number",
              "desc": "공급가액(부가세를 뺀 교육비) — 문서에 따로 적혀 있을 때만",
              "read": "공급가액(부가세를 뺀 교육비) — 문서에 따로 적혀 있을 때만",
              "example": 409091,
              "min": 0
            },
            "vat": {
              "type": "number",
              "desc": "부가세 — 문서에 따로 적혀 있을 때만",
              "read": "부가세 — 문서에 따로 적혀 있을 때만",
              "example": 40909,
              "min": 0
            },
            "currency": {
              "type": "enum",
              "label": "화폐",
              "desc": "합계의 화폐 — 원화가 아니면 합계를 원화로 고쳐 적는다(src/gongmun.js fromRecord 의 알림)",
              "read": "문서의 화폐(ISO 세 글자 코드). 원화 문서면 KRW",
              "default": "KRW",
              "values": [
                "KRW",
                "USD",
                "EUR",
                "JPY",
                "CNY",
                "GBP"
              ]
            },
            "attach": {
              "type": "list",
              "label": "첨부",
              "desc": "첨부 목록 — 문서 이름마다 그 문서로 묶는 파일 이름들(src/gongmun.js attachList — 레시피 attach_rules.yaml 의 parts)",
              "read": "첨부 문서마다 이름과 그 문서로 묶는 파일 이름들",
              "max": 20,
              "item": {
                "label": {
                  "type": "string",
                  "required": true,
                  "desc": "첨부 목록의 문서 이름(견적서·교육 안내 …)",
                  "read": "첨부 목록에 적는 문서 이름",
                  "max": 100
                },
                "files": {
                  "type": "tags",
                  "desc": "그 문서로 묶는 파일 이름들(자유 글의 목록 — values 없음)",
                  "read": "그 문서로 묶는 파일 이름들. 모르면 빈 목록"
                }
              }
            }
          }
        },
        "rank": {
          "type": "enum",
          "label": "전결권자",
          "desc": "이 공문에서 사람이 고른 전결권자 직책(registries/delegation.yaml 의 ranks). 비면 규정대로(레시피 purpose.yaml 의 rule_key — 구매·구매의뢰·교육은 연구비집행 금액 구간, 출장은 국내·해외, 외부활동은 팀장). 고르면 그것이 이긴다(delegationOf 의 overridden)",
          "read": "사용자가 전결권자(팀장·소장·본부장)를 말했을 때만. 그 밖에는 null(규정대로)",
          "llm": true,
          "ui": true,
          "values": [
            "팀장",
            "소장",
            "본부장"
          ]
        },
        "lead": {
          "type": "string",
          "label": "과제 책임자",
          "desc": "합의자 — 고른 과제의 책임자(R&D 탭 과제 정보). 기안자(preset.me) 본인이면 합의를 넣지 않는다",
          "read": "과제 책임자 이름",
          "llm": false,
          "ui": true,
          "max": 40
        },
        "refs": {
          "type": "tags",
          "label": "참조자",
          "desc": "결재선의 참조자 — R&D 탭 참여인력에서 공문 참조를 켠 사람과 계획서 YAML 의 공문.참조자.<갈래>(구매·교육·출장). 결재선에 이미 선 사람은 뺀다. 빈 목록이면 참조 없음",
          "read": "참조자 이름들",
          "llm": false,
          "ui": true
        },
        "setting": {
          "type": "object",
          "label": "문서설정",
          "desc": "이 공문에서 바꾼 문서설정만(없는 키는 레시피 프로파일·공문 설정대로 — docSettingOf). 전자결재 툴바의 '문서설정' 창에 넣는 값이다",
          "read": "사용자가 문서설정(보존년한·수신처·공개범위·긴급·검색 키워드 등)을 바꾸라고 했을 때만",
          "llm": false,
          "ui": true,
          "fields": {
            "retention": {
              "type": "enum",
              "desc": "보존년한 코드(1년·2년·3년·5년·10년·20년·영구 — settings.yaml options.retention. 품의는 10년, 신고서·구매요청서는 3년이 기본)",
              "read": "보존년한을 말했으면 그 코드(10년이면 120, 3년이면 36)",
              "values": [
                "12",
                "24",
                "36",
                "60",
                "120",
                "240",
                "1200"
              ]
            },
            "docNo": {
              "type": "string",
              "desc": "문서번호 부서 코드(Doc No. — ddlDocNo 의 값, 숫자만)",
              "read": "문서번호 부서를 코드로 말했을 때만",
              "max": 8
            },
            "receiver": {
              "type": "enum",
              "desc": "수신처(settings.yaml options.receiver — 부서는 receivers 의 코드로 SetReceiverValue. 구매요청서는 프로파일이 총무팀)",
              "read": "수신처를 말했을 때만 — 내부결재·KRE·총무팀",
              "values": [
                "내부결재",
                "KRE",
                "총무팀"
              ]
            },
            "scope": {
              "type": "enum",
              "desc": "공개범위(settings.yaml options.scope — 결재선 YNN·기안부서 NNY)",
              "read": "공개범위를 말했을 때만 — 결재선 또는 기안부서",
              "values": [
                "결재선",
                "기안부서"
              ]
            },
            "emergency": {
              "type": "boolean",
              "desc": "긴급",
              "read": "긴급이라고 했을 때만 true"
            },
            "approvingOpen": {
              "type": "boolean",
              "desc": "진행공개",
              "read": "진행공개라고 했을 때만 true"
            },
            "drm": {
              "type": "boolean",
              "desc": "DRM",
              "read": "DRM 을 걸라고 했을 때만 true"
            },
            "tag": {
              "type": "string",
              "desc": "검색 키워드(비면 프로파일대로 — 구매·구매의뢰·교육은 고른 과제의 별명, 출장은 '출장', 외부활동은 '외부활동'. 2026-10-12 사용자 지정 \"연구개발 별칭이 있다면 그걸 넣어줘, 외부활동이면 외부활동, 출장이면 출장\")",
              "read": "검색 키워드를 말했을 때만",
              "max": 60
            }
          }
        },
        "attach": {
          "type": "list",
          "label": "첨부",
          "desc": "첨부 파일 이름(바이트는 ctx.files — 이름으로 잇는다). 읽은 문서를 첨부 목록의 문서마다 PDF 로 묶은 것과 원본 첨부. 견적서를 오렸으면(cut) 오린 그림이 앞에 온다",
          "read": "첨부할 문서의 파일 이름 목록. 지어내지 않습니다",
          "llm": false,
          "ui": true,
          "max": 5,
          "item": {
            "name": {
              "type": "string",
              "required": true,
              "desc": "파일 이름(견적서_업체_날짜.pdf 처럼 attachName 이 지은 것이거나 원본 이름)",
              "read": "파일 이름",
              "max": 200
            },
            "kind": {
              "type": "string",
              "desc": "무엇의 문서인지(첨부 목록의 문서 이름 — 견적서·거래명세서·교육 내용·행사 안내문·요청 공문 …, 원본 첨부면 original)",
              "read": "무엇의 문서인지. 모르면 null",
              "max": 40
            }
          }
        }
      },
      "checks": [],
      "rules": [],
      "llm": {
        "tasks": [
          {
            "task": "gongmun.edu",
            "fills": "draft"
          },
          {
            "task": "gongmunReason.edu",
            "fills": "draft"
          }
        ]
      },
      "runner": "gongmun.write",
      "uses": [
        {
          "module": "src/gongmun.js",
          "export": "writePlan"
        },
        {
          "module": "src/gmwrite.js",
          "export": "writeGongmun"
        }
      ],
      "then": [],
      "next": "뒤 탭에 공문을 쓴다(과제·제목·차수·본문·문서설정·결재선·첨부). ok 는 steps 에 ok false 가 없을 때다. 임시저장·상신은 사람이 창에서 한다"
    },
    "gongmun.trip": {
      "id": "gongmun.trip",
      "domain": "gongmun",
      "kind": "trip",
      "title": "출장품의 작성",
      "status": "live",
      "confirm": true,
      "effect": "write",
      "log": "gongmun",
      "summary": "{preset.kindTitle} · {title}",
      "preset": {
        "me": {
          "from": "me",
          "desc": "기안자(내 이름 — 결재선의 기안, 과제책임자가 본인이면 합의를 뺀다)",
          "required": true
        },
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — writePlan 의 ctx.today(첨부 이름·본문 날짜 자리)"
        },
        "setup": {
          "from": "storage:gongmunPreset",
          "type": "object",
          "desc": "공문 설정(부서·부서장·소장·본부장·문서번호 부서 — 실명은 여기에만 둔다). 어댑터가 writePlan 의 ctx.preset 으로 그대로 넘긴다 — 문서번호·결재선이 여기서 나온다",
          "required": true
        },
        "project": {
          "from": "ctx:project",
          "type": "object",
          "desc": "고른 과제(이름·별명·번호·Job Id(과제 찾기)·책임자·연구기간·개요·내용·계정·공문 참조자 refs·rnd.year). 별명이 제목에 들어간다. 로그에서 뺀다",
          "log": false
        },
        "kindTitle": {
          "from": "recipe:purposes.trip.title",
          "desc": "갈래 이름(레시피 purpose.yaml 의 title — 출장품의) — 활동 로그 한 줄에 쓴다"
        }
      },
      "fields": {
        "form": {
          "type": "string",
          "required": true,
          "label": "양식",
          "desc": "eclass 전자결재 양식 ID(src/gongmun.js formsFor(종류) — 연구업무추진품의 KR_EA_Research_Task 가 기본, 기안문 KR_EA_Form2 는 본문만 있는 양식, 외부활동만 외부강의등 신고서). 목록에 없는 ID 를 직접 적으면 칸 지도가 없어 새 공문 창을 열기만 한다. 외부활동·구매의뢰는 종류 파일이 통째로 적는다(신고서·구매요청서가 기본)",
          "read": "품의 양식 — 연구업무추진품의(KR_EA_Research_Task)가 기본. 기안문이라고 했을 때만 KR_EA_Form2",
          "llm": true,
          "ui": true,
          "default": "KR_EA_Research_Task",
          "max": 60
        },
        "title": {
          "type": "string",
          "required": true,
          "label": "제목",
          "desc": "공문 제목(레시피 body_spec.yaml 의 제목 틀 — \"{품목요지} 구매 품의\"·\"{과제별명} 수행을 위한 {교육구분} 품의\"·\"… 출장 품의\"·신고서는 \"외부강의등 신고서\" — 을 채운 글. 전자결재가 99자에서 자른다. 사람이 고쳤으면 그 글)",
          "read": "제목 틀을 채운 제목. 사용자가 제목을 말했으면 그것",
          "llm": true,
          "ui": true,
          "max": 99
        },
        "body": {
          "type": "string",
          "required": true,
          "label": "본문",
          "desc": "본문(레시피 body_spec.yaml 의 본문 틀을 채운 글 — src/gongmun.js compose. 사람이 고쳤으면 그 글). 긴 줄표는 어댑터 쪽 writePlan 이 '-' 로 바꾼다(eclassText). 칸이 정해진 폼(외부강의등 신고서·구매요청서 — 그 종류 파일이 when 으로 뺀다)에서는 넣을 칸의 미리보기다",
          "read": "본문 틀을 채운 글",
          "llm": false,
          "ui": true,
          "max": 20000
        },
        "draft": {
          "type": "object",
          "label": "초안",
          "desc": "초안 칸(레시피 purpose.yaml 의 fields — 생성기가 펼친다). 읽은 문서(gongmun.trip)와 과제 내용으로 쓴 사유(gongmunReason.trip)가 채우고 사람이 고친다. division(국내·해외)이 위임전결을 정한다",
          "read": "읽은 문서와 과제 내용으로 채운 초안",
          "llm": true,
          "ui": true,
          "from": "recipe",
          "fields": {
            "place": {
              "type": "string",
              "label": "출장지",
              "desc": "출장지",
              "read": "행사·회의가 열리는 도시와 기관 — \"도시(기관)\" 꼴로 적습니다.",
              "example": "대전(한국기계연구원)",
              "max": 200
            },
            "from": {
              "type": "date",
              "label": "시작일",
              "desc": "시작일",
              "read": "출장 시작일 — 행사·회의의 첫날. 참가 신청·등록 마감일과 헷갈리지 않습니다. 연도가 적혀 있지 않으면 문서 발행일(없으면 오늘)의 연도를 붙입니다.",
              "example": "2026-10-20"
            },
            "to": {
              "type": "date",
              "label": "종료일",
              "desc": "종료일",
              "read": "출장 종료일 — 행사·회의의 마지막 날. 하루짜리면 시작일과 같은 날입니다.",
              "example": "2026-10-21"
            },
            "who": {
              "type": "string",
              "label": "출장자",
              "desc": "출장자",
              "read": "출장자 칸",
              "max": 200
            },
            "cost": {
              "type": "number",
              "label": "예상경비 (원)",
              "desc": "예상경비 (원)",
              "read": "교통·숙박 견적서가 함께 있으면 그 합계(부가세 포함)입니다. 행사 안내문·초청장만 있으면 null 입니다.",
              "example": 300000,
              "min": 0
            },
            "division": {
              "type": "enum",
              "label": "출장 구분 (위임전결)",
              "desc": "출장 구분 (위임전결)",
              "read": "출장 구분 (위임전결) 칸",
              "values": [
                "국내",
                "해외"
              ]
            },
            "purpose": {
              "type": "string",
              "label": "출장목적",
              "desc": "출장목적",
              "read": "무엇을 하러 가는지 짧은 구절로. 문서에 적혀 있으면 그대로, 없으면 행사·회의명으로 \"○○ 참석\" 처럼 적습니다 — 비워 두지 않습니다.",
              "example": "2026 한국조선해양기자재 학회 참석 및 발표",
              "max": 200
            },
            "reason": {
              "type": "string",
              "label": "출장사유",
              "desc": "출장사유",
              "read": "출장사유 칸",
              "example": "과제의 실증 시험 결과를 확인하고 시험 조건을 협의하기 위해 필요함",
              "max": 1000
            },
            "account": {
              "type": "string",
              "label": "예산계정",
              "desc": "예산계정",
              "read": "예산계정 칸",
              "max": 200
            },
            "currency": {
              "type": "enum",
              "label": "화폐",
              "desc": "합계의 화폐 — 원화가 아니면 합계를 원화로 고쳐 적는다(src/gongmun.js fromRecord 의 알림)",
              "read": "문서의 화폐(ISO 세 글자 코드). 원화 문서면 KRW",
              "default": "KRW",
              "values": [
                "KRW",
                "USD",
                "EUR",
                "JPY",
                "CNY",
                "GBP"
              ]
            },
            "attach": {
              "type": "list",
              "label": "첨부",
              "desc": "첨부 목록 — 문서 이름마다 그 문서로 묶는 파일 이름들(src/gongmun.js attachList — 레시피 attach_rules.yaml 의 parts)",
              "read": "첨부 문서마다 이름과 그 문서로 묶는 파일 이름들",
              "max": 20,
              "item": {
                "label": {
                  "type": "string",
                  "required": true,
                  "desc": "첨부 목록의 문서 이름(견적서·교육 안내 …)",
                  "read": "첨부 목록에 적는 문서 이름",
                  "max": 100
                },
                "files": {
                  "type": "tags",
                  "desc": "그 문서로 묶는 파일 이름들(자유 글의 목록 — values 없음)",
                  "read": "그 문서로 묶는 파일 이름들. 모르면 빈 목록"
                }
              }
            }
          }
        },
        "rank": {
          "type": "enum",
          "label": "전결권자",
          "desc": "이 공문에서 사람이 고른 전결권자 직책(registries/delegation.yaml 의 ranks). 비면 규정대로(레시피 purpose.yaml 의 rule_key — 구매·구매의뢰·교육은 연구비집행 금액 구간, 출장은 국내·해외, 외부활동은 팀장). 고르면 그것이 이긴다(delegationOf 의 overridden)",
          "read": "사용자가 전결권자(팀장·소장·본부장)를 말했을 때만. 그 밖에는 null(규정대로)",
          "llm": true,
          "ui": true,
          "values": [
            "팀장",
            "소장",
            "본부장"
          ]
        },
        "lead": {
          "type": "string",
          "label": "과제 책임자",
          "desc": "합의자 — 고른 과제의 책임자(R&D 탭 과제 정보). 기안자(preset.me) 본인이면 합의를 넣지 않는다",
          "read": "과제 책임자 이름",
          "llm": false,
          "ui": true,
          "max": 40
        },
        "refs": {
          "type": "tags",
          "label": "참조자",
          "desc": "결재선의 참조자 — R&D 탭 참여인력에서 공문 참조를 켠 사람과 계획서 YAML 의 공문.참조자.<갈래>(구매·교육·출장). 결재선에 이미 선 사람은 뺀다. 빈 목록이면 참조 없음",
          "read": "참조자 이름들",
          "llm": false,
          "ui": true
        },
        "setting": {
          "type": "object",
          "label": "문서설정",
          "desc": "이 공문에서 바꾼 문서설정만(없는 키는 레시피 프로파일·공문 설정대로 — docSettingOf). 전자결재 툴바의 '문서설정' 창에 넣는 값이다",
          "read": "사용자가 문서설정(보존년한·수신처·공개범위·긴급·검색 키워드 등)을 바꾸라고 했을 때만",
          "llm": false,
          "ui": true,
          "fields": {
            "retention": {
              "type": "enum",
              "desc": "보존년한 코드(1년·2년·3년·5년·10년·20년·영구 — settings.yaml options.retention. 품의는 10년, 신고서·구매요청서는 3년이 기본)",
              "read": "보존년한을 말했으면 그 코드(10년이면 120, 3년이면 36)",
              "values": [
                "12",
                "24",
                "36",
                "60",
                "120",
                "240",
                "1200"
              ]
            },
            "docNo": {
              "type": "string",
              "desc": "문서번호 부서 코드(Doc No. — ddlDocNo 의 값, 숫자만)",
              "read": "문서번호 부서를 코드로 말했을 때만",
              "max": 8
            },
            "receiver": {
              "type": "enum",
              "desc": "수신처(settings.yaml options.receiver — 부서는 receivers 의 코드로 SetReceiverValue. 구매요청서는 프로파일이 총무팀)",
              "read": "수신처를 말했을 때만 — 내부결재·KRE·총무팀",
              "values": [
                "내부결재",
                "KRE",
                "총무팀"
              ]
            },
            "scope": {
              "type": "enum",
              "desc": "공개범위(settings.yaml options.scope — 결재선 YNN·기안부서 NNY)",
              "read": "공개범위를 말했을 때만 — 결재선 또는 기안부서",
              "values": [
                "결재선",
                "기안부서"
              ]
            },
            "emergency": {
              "type": "boolean",
              "desc": "긴급",
              "read": "긴급이라고 했을 때만 true"
            },
            "approvingOpen": {
              "type": "boolean",
              "desc": "진행공개",
              "read": "진행공개라고 했을 때만 true"
            },
            "drm": {
              "type": "boolean",
              "desc": "DRM",
              "read": "DRM 을 걸라고 했을 때만 true"
            },
            "tag": {
              "type": "string",
              "desc": "검색 키워드(비면 프로파일대로 — 구매·구매의뢰·교육은 고른 과제의 별명, 출장은 '출장', 외부활동은 '외부활동'. 2026-10-12 사용자 지정 \"연구개발 별칭이 있다면 그걸 넣어줘, 외부활동이면 외부활동, 출장이면 출장\")",
              "read": "검색 키워드를 말했을 때만",
              "max": 60
            }
          }
        },
        "attach": {
          "type": "list",
          "label": "첨부",
          "desc": "첨부 파일 이름(바이트는 ctx.files — 이름으로 잇는다). 읽은 문서를 첨부 목록의 문서마다 PDF 로 묶은 것과 원본 첨부. 견적서를 오렸으면(cut) 오린 그림이 앞에 온다",
          "read": "첨부할 문서의 파일 이름 목록. 지어내지 않습니다",
          "llm": false,
          "ui": true,
          "max": 5,
          "item": {
            "name": {
              "type": "string",
              "required": true,
              "desc": "파일 이름(견적서_업체_날짜.pdf 처럼 attachName 이 지은 것이거나 원본 이름)",
              "read": "파일 이름",
              "max": 200
            },
            "kind": {
              "type": "string",
              "desc": "무엇의 문서인지(첨부 목록의 문서 이름 — 견적서·거래명세서·교육 내용·행사 안내문·요청 공문 …, 원본 첨부면 original)",
              "read": "무엇의 문서인지. 모르면 null",
              "max": 40
            }
          }
        }
      },
      "checks": [],
      "rules": [],
      "llm": {
        "tasks": [
          {
            "task": "gongmun.trip",
            "fills": "draft"
          },
          {
            "task": "gongmunReason.trip",
            "fills": "draft"
          }
        ]
      },
      "runner": "gongmun.write",
      "uses": [
        {
          "module": "src/gongmun.js",
          "export": "writePlan"
        },
        {
          "module": "src/gmwrite.js",
          "export": "writeGongmun"
        }
      ],
      "then": [],
      "next": "뒤 탭에 공문을 쓴다(과제·제목·차수·본문·문서설정·결재선·첨부). ok 는 steps 에 ok false 가 없을 때다. 임시저장·상신은 사람이 창에서 한다"
    },
    "gongmun.order": {
      "id": "gongmun.order",
      "domain": "gongmun",
      "kind": "order",
      "title": "구매요청서 작성",
      "status": "live",
      "confirm": true,
      "effect": "write",
      "log": "gongmun",
      "summary": "{preset.kindTitle} · {title}",
      "preset": {
        "me": {
          "from": "me",
          "desc": "기안자(내 이름 — 결재선의 기안, 과제책임자가 본인이면 합의를 뺀다)",
          "required": true
        },
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — writePlan 의 ctx.today(첨부 이름·본문 날짜 자리)"
        },
        "setup": {
          "from": "storage:gongmunPreset",
          "type": "object",
          "desc": "공문 설정(부서·부서장·소장·본부장·문서번호 부서 — 실명은 여기에만 둔다). 어댑터가 writePlan 의 ctx.preset 으로 그대로 넘긴다 — 문서번호·결재선이 여기서 나온다",
          "required": true
        },
        "project": {
          "from": "ctx:project",
          "type": "object",
          "desc": "고른 과제(이름·별명·번호·Job Id(과제 찾기)·책임자·연구기간·개요·내용·계정·공문 참조자 refs·rnd.year — 공문 탭이 R&D 탭의 과제에서 고른 것. 사업내용(gongmunReason.order)과 계정과목명(orderAuto)이 여기서 나온다. 과제 내용 3000자가 들어 있어 로그에서 뺀다)",
          "log": false
        },
        "kindTitle": {
          "from": "recipe:purposes.order.title",
          "desc": "갈래 이름(레시피 purpose.yaml 의 title — 구매요청서) — 활동 로그 한 줄에 쓴다"
        }
      },
      "fields": {
        "form": {
          "type": "string",
          "required": true,
          "label": "양식",
          "desc": "eclass 전자결재 양식 ID(formsFor('order') — 구매요청서 KR_Purchase_Order 가 기본(총무팀 수신, 칸이 정해진 폼). 연구업무추진품의 KR_EA_Research_Task·기안문 KR_EA_Form2 는 본문 틀로 쓸 때)",
          "read": "양식 — 구매요청서(KR_Purchase_Order)가 기본",
          "llm": true,
          "ui": true,
          "default": "KR_Purchase_Order",
          "max": 60
        },
        "title": {
          "type": "string",
          "required": true,
          "label": "제목",
          "desc": "공문 제목(레시피 body_spec.yaml 의 제목 틀 — \"{품목요지} 구매 품의\"·\"{과제별명} 수행을 위한 {교육구분} 품의\"·\"… 출장 품의\"·신고서는 \"외부강의등 신고서\" — 을 채운 글. 전자결재가 99자에서 자른다. 사람이 고쳤으면 그 글)",
          "read": "제목 틀을 채운 제목. 사용자가 제목을 말했으면 그것",
          "llm": true,
          "ui": true,
          "max": 99
        },
        "body": {
          "type": "string",
          "required": true,
          "label": "본문",
          "desc": "본문 — 양식을 본문 편집기가 있는 것(연구업무추진품의·기안문)으로 바꿨을 때만. 구매요청서(KR_Purchase_Order)에서는 칸이 없어 기록에도 없다(공문 탭의 본문 칸은 미리보기)",
          "read": "본문 틀을 채운 글",
          "llm": false,
          "ui": true,
          "when": "form!=KR_Purchase_Order",
          "max": 20000
        },
        "draft": {
          "type": "object",
          "label": "초안",
          "desc": "초안 칸(레시피 purpose.yaml 의 fields·reads — 생성기가 펼친다). 읽은 문서(gongmun.order)와 과제 내용으로 쓴 사업내용(gongmunReason.order)이 채우고, 구매 품의에서 넘어오면(orderFromPurchase) 그 값이 먼저 들며, 수요시기·특기사항·계정과목명·첨부자료 안내문구와 예산 내역(회계 I/O·계정 줄 — 과제의 회계 스냅샷)은 비면 패널이 셈하고(orderAuto) 사람이 고친다",
          "read": "읽은 문서와 과제 내용으로 채운 구매요청서의 칸",
          "llm": true,
          "ui": true,
          "from": "recipe",
          "fields": {
            "gist": {
              "type": "string",
              "label": "품목 요지 (제목)",
              "desc": "품목 요지 (제목)",
              "read": "공문 제목에 들어갈 짧은 품목 이름. 대표 품목을 짧게 적고(모델 번호는 빼도 됩니다), 품목이 둘 이상이면 \"대표 품목 외 N건\" 으로 적습니다.",
              "example": "34인치 모니터 외 1건",
              "max": 200
            },
            "vendor": {
              "type": "string",
              "label": "구매처",
              "desc": "구매처",
              "read": "견적을 낸 업체·판매처 — 상호 그대로. 쇼핑몰 화면이면 판매자이고, 판매자가 없으면 쇼핑몰 이름입니다.",
              "example": "(주)OO상사",
              "max": 200
            },
            "total": {
              "type": "number",
              "label": "합계 (VAT 포함, 원)",
              "desc": "합계 (VAT 포함, 원)",
              "read": "부가세를 포함한 최종 합계(결제·청구할 금액). 할인이 있으면 할인을 뺀 금액입니다. 문서에 \"부가세 별도\" 이고 합계가 공급가액뿐이면 null 로 두고 supply 에 적습니다 — 셈해 넣지 않습니다.",
              "example": 989000,
              "min": 0
            },
            "targetType": {
              "type": "enum",
              "label": "구매대상구분",
              "desc": "구매대상구분",
              "read": "구매대상구분 — 품목으로 가립니다. PC·노트북·모니터·프린터와 그 주변기기는 PC류, 시험 장비·계측기·기기·비품(자산으로 등록할 것)은 자산, 용역·서비스·제작·수리·교정은 용역, 소프트웨어·구독·라이선스는 SW, 그 밖(부품·재료·케이블·사무용품)은 소모품입니다. 품목이 여럿이면 금액이 가장 큰 품목으로 가립니다. 문서에 구분이 적혀 있지 않아도 품목을 보고 적습니다.",
              "example": "PC류",
              "values": [
                "PC류",
                "자산",
                "용역",
                "SW",
                "소모품"
              ]
            },
            "budgetType": {
              "type": "enum",
              "label": "예산유형",
              "desc": "예산유형",
              "read": "예산유형 칸",
              "values": [
                "국가수탁과제",
                "일반사업"
              ]
            },
            "business": {
              "type": "string",
              "label": "사업내용 (목적 포함)",
              "desc": "사업내용 (목적 포함)",
              "read": "사업내용 (목적 포함) 칸",
              "example": "MW급 10kV 고전압 직류 시스템용 반도체 차단기 개발 과제에서 MVDC 차단기의 단락 시험과 데이터 분석을 수행하고 있음. 시험 데이터를 저장·분석할 PC 와 모니터가 필요함",
              "max": 1000
            },
            "demandDate": {
              "type": "date",
              "label": "수요시기 (납품일)",
              "desc": "수요시기 (납품일)",
              "read": "수요시기 (납품일) 칸"
            },
            "place": {
              "type": "string",
              "label": "납품장소",
              "desc": "납품장소",
              "read": "납품장소 칸",
              "max": 200
            },
            "feature": {
              "type": "string",
              "label": "특기사항",
              "desc": "특기사항",
              "read": "특기사항 칸",
              "max": 1000
            },
            "subjectCode": {
              "type": "string",
              "label": "계정과목코드",
              "desc": "계정과목코드",
              "read": "계정과목코드 칸",
              "max": 200
            },
            "subjectName": {
              "type": "string",
              "label": "계정과목명",
              "desc": "계정과목명",
              "read": "계정과목명 칸",
              "max": 200
            },
            "ioCode": {
              "type": "string",
              "label": "I/O 코드 (예산부서 코드)",
              "desc": "I/O 코드 (예산부서 코드)",
              "read": "I/O 코드 (예산부서 코드) 칸",
              "max": 200
            },
            "ioName": {
              "type": "string",
              "label": "I/O 명 (예산부서명)",
              "desc": "I/O 명 (예산부서명)",
              "read": "I/O 명 (예산부서명) 칸",
              "max": 200
            },
            "budgetAmount": {
              "type": "number",
              "label": "예산금액 (비목의 당해 연도 배정액, 원)",
              "desc": "예산금액 (비목의 당해 연도 배정액, 원)",
              "read": "예산금액 (비목의 당해 연도 배정액, 원) 칸",
              "min": 0
            },
            "sourceDoc": {
              "type": "string",
              "label": "선행 품의 문서번호",
              "desc": "선행 품의 문서번호",
              "read": "선행 품의 문서번호 칸",
              "max": 200
            },
            "sourceTitle": {
              "type": "string",
              "label": "선행 품의 제목",
              "desc": "선행 품의 제목",
              "read": "선행 품의 제목 칸",
              "max": 200
            },
            "attachNote": {
              "type": "string",
              "label": "첨부자료 안내문구",
              "desc": "첨부자료 안내문구",
              "read": "첨부자료 안내문구 칸",
              "max": 1000
            },
            "items": {
              "type": "list",
              "desc": "품목. 문서의 품목 표를 적힌 차례대로 한 줄씩 옮깁니다. 배송비·설치비처럼 따로 적힌 줄도 품목으로 넣습니다.",
              "read": "품목. 문서의 품목 표를 적힌 차례대로 한 줄씩 옮깁니다. 배송비·설치비처럼 따로 적힌 줄도 품목으로 넣습니다.",
              "max": 30,
              "item": {
                "name": {
                  "type": "string",
                  "required": true,
                  "desc": "품목명·모델명 — 문서에 적힌 그대로(요약하지 않습니다)",
                  "read": "품목명·모델명 — 문서에 적힌 그대로(요약하지 않습니다)",
                  "example": "LG 34WQ75C 34인치 모니터",
                  "max": 200
                },
                "spec": {
                  "type": "string",
                  "desc": "규격·사양 — 문서에 적힌 핵심을 ' · ' 로 나열",
                  "read": "규격·사양 — 문서에 적힌 핵심을 ' · ' 로 나열",
                  "example": "WQHD · 커브드 · USB-C",
                  "max": 300
                },
                "qty": {
                  "type": "number",
                  "desc": "수량",
                  "read": "수량",
                  "example": 1,
                  "min": 0
                },
                "unit": {
                  "type": "string",
                  "desc": "단위(개·대·EA·식 등)",
                  "read": "단위(개·대·EA·식 등)",
                  "example": "대",
                  "max": 10
                },
                "unitPrice": {
                  "type": "number",
                  "desc": "단가",
                  "read": "단가",
                  "example": 890000,
                  "min": 0
                },
                "amount": {
                  "type": "number",
                  "desc": "그 줄의 금액 — 문서에 적힌 그대로",
                  "read": "그 줄의 금액 — 문서에 적힌 그대로",
                  "example": 890000,
                  "min": 0
                }
              }
            },
            "quoteDate": {
              "type": "date",
              "desc": "견적일·발행일·주문일. 쇼핑몰 화면이면 주문일이고, 주문 전 장바구니·상품 화면이면 null 입니다.",
              "read": "견적일·발행일·주문일. 쇼핑몰 화면이면 주문일이고, 주문 전 장바구니·상품 화면이면 null 입니다.",
              "example": "2026-10-01"
            },
            "supply": {
              "type": "number",
              "desc": "공급가액 합계(부가세를 뺀 금액) — 문서에 따로 적혀 있을 때만",
              "read": "공급가액 합계(부가세를 뺀 금액) — 문서에 따로 적혀 있을 때만",
              "example": 899091,
              "min": 0
            },
            "vat": {
              "type": "number",
              "desc": "부가세 합계 — 문서에 따로 적혀 있을 때만",
              "read": "부가세 합계 — 문서에 따로 적혀 있을 때만",
              "example": 89909,
              "min": 0
            },
            "currency": {
              "type": "enum",
              "label": "화폐",
              "desc": "합계의 화폐 — 원화가 아니면 합계를 원화로 고쳐 적는다(src/gongmun.js fromRecord 의 알림)",
              "read": "문서의 화폐(ISO 세 글자 코드). 원화 문서면 KRW",
              "default": "KRW",
              "values": [
                "KRW",
                "USD",
                "EUR",
                "JPY",
                "CNY",
                "GBP"
              ]
            },
            "attach": {
              "type": "list",
              "label": "첨부",
              "desc": "첨부 목록 — 문서 이름마다 그 문서로 묶는 파일 이름들(src/gongmun.js attachList — 레시피 attach_rules.yaml 의 parts)",
              "read": "첨부 문서마다 이름과 그 문서로 묶는 파일 이름들",
              "max": 20,
              "item": {
                "label": {
                  "type": "string",
                  "required": true,
                  "desc": "첨부 목록의 문서 이름(견적서·교육 안내 …)",
                  "read": "첨부 목록에 적는 문서 이름",
                  "max": 100
                },
                "files": {
                  "type": "tags",
                  "desc": "그 문서로 묶는 파일 이름들(자유 글의 목록 — values 없음)",
                  "read": "그 문서로 묶는 파일 이름들. 모르면 빈 목록"
                }
              }
            }
          }
        },
        "rank": {
          "type": "enum",
          "label": "전결권자",
          "desc": "이 공문에서 사람이 고른 전결권자 직책(registries/delegation.yaml 의 ranks). 비면 규정대로(레시피 purpose.yaml 의 rule_key — 구매·구매의뢰·교육은 연구비집행 금액 구간, 출장은 국내·해외, 외부활동은 팀장). 고르면 그것이 이긴다(delegationOf 의 overridden)",
          "read": "사용자가 전결권자(팀장·소장·본부장)를 말했을 때만. 그 밖에는 null(규정대로)",
          "llm": true,
          "ui": true,
          "values": [
            "팀장",
            "소장",
            "본부장"
          ]
        },
        "lead": {
          "type": "string",
          "label": "과제 책임자",
          "desc": "합의자 — 고른 과제의 책임자(R&D 탭 과제 정보). 기안자(preset.me) 본인이면 합의를 넣지 않는다",
          "read": "과제 책임자 이름",
          "llm": false,
          "ui": true,
          "max": 40
        },
        "refs": {
          "type": "tags",
          "label": "참조자",
          "desc": "결재선의 참조자 — R&D 탭 참여인력에서 공문 참조를 켠 사람과 계획서 YAML 의 공문.참조자.<갈래>(구매·교육·출장). 결재선에 이미 선 사람은 뺀다. 빈 목록이면 참조 없음",
          "read": "참조자 이름들",
          "llm": false,
          "ui": true
        },
        "setting": {
          "type": "object",
          "label": "문서설정",
          "desc": "이 공문에서 바꾼 문서설정만(없는 키는 레시피 프로파일·공문 설정대로 — docSettingOf). 전자결재 툴바의 '문서설정' 창에 넣는 값이다",
          "read": "사용자가 문서설정(보존년한·수신처·공개범위·긴급·검색 키워드 등)을 바꾸라고 했을 때만",
          "llm": false,
          "ui": true,
          "fields": {
            "retention": {
              "type": "enum",
              "desc": "보존년한 코드(1년·2년·3년·5년·10년·20년·영구 — settings.yaml options.retention. 품의는 10년, 신고서·구매요청서는 3년이 기본)",
              "read": "보존년한을 말했으면 그 코드(10년이면 120, 3년이면 36)",
              "values": [
                "12",
                "24",
                "36",
                "60",
                "120",
                "240",
                "1200"
              ]
            },
            "docNo": {
              "type": "string",
              "desc": "문서번호 부서 코드(Doc No. — ddlDocNo 의 값, 숫자만)",
              "read": "문서번호 부서를 코드로 말했을 때만",
              "max": 8
            },
            "receiver": {
              "type": "enum",
              "desc": "수신처(settings.yaml options.receiver — 부서는 receivers 의 코드로 SetReceiverValue. 구매요청서는 프로파일이 총무팀)",
              "read": "수신처를 말했을 때만 — 내부결재·KRE·총무팀",
              "values": [
                "내부결재",
                "KRE",
                "총무팀"
              ]
            },
            "scope": {
              "type": "enum",
              "desc": "공개범위(settings.yaml options.scope — 결재선 YNN·기안부서 NNY)",
              "read": "공개범위를 말했을 때만 — 결재선 또는 기안부서",
              "values": [
                "결재선",
                "기안부서"
              ]
            },
            "emergency": {
              "type": "boolean",
              "desc": "긴급",
              "read": "긴급이라고 했을 때만 true"
            },
            "approvingOpen": {
              "type": "boolean",
              "desc": "진행공개",
              "read": "진행공개라고 했을 때만 true"
            },
            "drm": {
              "type": "boolean",
              "desc": "DRM",
              "read": "DRM 을 걸라고 했을 때만 true"
            },
            "tag": {
              "type": "string",
              "desc": "검색 키워드(비면 프로파일대로 — 구매·구매의뢰·교육은 고른 과제의 별명, 출장은 '출장', 외부활동은 '외부활동'. 2026-10-12 사용자 지정 \"연구개발 별칭이 있다면 그걸 넣어줘, 외부활동이면 외부활동, 출장이면 출장\")",
              "read": "검색 키워드를 말했을 때만",
              "max": 60
            }
          }
        },
        "attach": {
          "type": "list",
          "label": "첨부",
          "desc": "첨부 파일 이름(바이트는 ctx.files — 이름으로 잇는다). 읽은 문서를 첨부 목록의 문서마다 PDF 로 묶은 것과 원본 첨부. 견적서를 오렸으면(cut) 오린 그림이 앞에 온다",
          "read": "첨부할 문서의 파일 이름 목록. 지어내지 않습니다",
          "llm": false,
          "ui": true,
          "max": 5,
          "item": {
            "name": {
              "type": "string",
              "required": true,
              "desc": "파일 이름(견적서_업체_날짜.pdf 처럼 attachName 이 지은 것이거나 원본 이름)",
              "read": "파일 이름",
              "max": 200
            },
            "kind": {
              "type": "string",
              "desc": "무엇의 문서인지(첨부 목록의 문서 이름 — 견적서·거래명세서·교육 내용·행사 안내문·요청 공문 …, 원본 첨부면 original)",
              "read": "무엇의 문서인지. 모르면 null",
              "max": 40
            }
          }
        }
      },
      "checks": [],
      "rules": [],
      "llm": {
        "tasks": [
          {
            "task": "gongmun.order",
            "fills": "draft"
          },
          {
            "task": "gongmunReason.order",
            "fills": "draft"
          }
        ]
      },
      "runner": "gongmun.write",
      "uses": [
        {
          "module": "src/gongmun.js",
          "export": "writePlan"
        },
        {
          "module": "src/gmwrite.js",
          "export": "writeGongmun"
        }
      ],
      "then": [],
      "next": "뒤 탭에 구매요청서를 쓴다(제목·표(구매 물품·예산 내역 — 행추가 포스트백 뒤 행 수를 폴링)·양식 칸·문서설정(수신 총무팀)·결재선·첨부 — 과제(Job Id)·차수·본문 칸이 없는 양식이라 제목과 칸·표만). ok 는 steps 에 ok false 가 없을 때다. 임시저장·상신은 사람이 창에서 한다 — 상신 전 검사(formSubmit)가 구매대상구분·사업내용·예산유형·수요시기·납품장소·특기사항이 비면 막는다"
    },
    "gongmun.outside": {
      "id": "gongmun.outside",
      "domain": "gongmun",
      "kind": "outside",
      "title": "외부강의등 신고서 작성",
      "status": "live",
      "confirm": true,
      "effect": "write",
      "log": "gongmun",
      "summary": "{preset.kindTitle} · {title}",
      "preset": {
        "me": {
          "from": "me",
          "desc": "기안자(내 이름 — 결재선의 기안, 과제책임자가 본인이면 합의를 뺀다)",
          "required": true
        },
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — writePlan 의 ctx.today(첨부 이름·본문 날짜 자리)"
        },
        "setup": {
          "from": "storage:gongmunPreset",
          "type": "object",
          "desc": "공문 설정(부서·부서장·소장·본부장·문서번호 부서 — 실명은 여기에만 둔다). 어댑터가 writePlan 의 ctx.preset 으로 그대로 넘긴다 — 문서번호·결재선이 여기서 나온다",
          "required": true
        },
        "kindTitle": {
          "from": "recipe:purposes.outside.title",
          "desc": "갈래 이름(레시피 purpose.yaml 의 title — 외부강의등 신고서) — 활동 로그 한 줄에 쓴다"
        }
      },
      "fields": {
        "form": {
          "type": "string",
          "required": true,
          "label": "양식",
          "desc": "eclass 전자결재 양식 ID(formsFor('outside') — 외부강의등 신고서 KR_Outside_Lecture_Report 가 기본. 연구업무추진품의·기안문은 본문 틀로 쓸 때)",
          "read": "양식 — 외부강의등 신고서(KR_Outside_Lecture_Report)가 기본",
          "llm": true,
          "ui": true,
          "default": "KR_Outside_Lecture_Report",
          "max": 60
        },
        "title": {
          "type": "string",
          "required": true,
          "label": "제목",
          "desc": "공문 제목(레시피 body_spec.yaml 의 제목 틀 — \"{품목요지} 구매 품의\"·\"{과제별명} 수행을 위한 {교육구분} 품의\"·\"… 출장 품의\"·신고서는 \"외부강의등 신고서\" — 을 채운 글. 전자결재가 99자에서 자른다. 사람이 고쳤으면 그 글)",
          "read": "제목 틀을 채운 제목. 사용자가 제목을 말했으면 그것",
          "llm": true,
          "ui": true,
          "max": 99
        },
        "body": {
          "type": "string",
          "required": true,
          "label": "본문",
          "desc": "본문 — 양식을 본문 편집기가 있는 것(연구업무추진품의·기안문)으로 바꿨을 때만. 신고서(KR_Outside_Lecture_Report)에서는 칸이 없어 기록에도 없다(공문 탭의 본문 칸은 미리보기)",
          "read": "본문 틀을 채운 글",
          "llm": false,
          "ui": true,
          "when": "form!=KR_Outside_Lecture_Report",
          "max": 20000
        },
        "draft": {
          "type": "object",
          "label": "초안",
          "desc": "초안 칸(레시피 purpose.yaml 의 fields — 생성기가 펼친다). 읽은 문서(gongmun.outside)가 채우고 직급·누적은 패널이 셈하며 사람이 고친다",
          "read": "읽은 문서로 채운 신고서의 칸",
          "llm": true,
          "ui": true,
          "from": "recipe",
          "fields": {
            "org": {
              "type": "string",
              "label": "기관명",
              "desc": "기관명",
              "read": "외부강의 등을 요청한 기관 — 공문의 발신 기관이나 메일을 보낸 기관의 이름 그대로. 학과·부서는 담당부서 칸에 적습니다.",
              "example": "부산대학교",
              "max": 200
            },
            "representative": {
              "type": "string",
              "label": "대표자",
              "desc": "대표자",
              "read": "요청 기관의 대표자(기관장) 이름 — 공문 끝의 발신 명의나 기관장 이름. 직함만 있고 이름이 문서에 없으면 null 입니다.",
              "example": "홍길동",
              "max": 200
            },
            "contact": {
              "type": "string",
              "label": "담당부서(담당자)",
              "desc": "담당부서(담당자)",
              "read": "요청한 부서와 담당자 — \"부서(담당자 이름)\" 꼴. 공문의 담당자·문의처 줄이나 메일 서명에서 읽습니다.",
              "example": "조선해양공학과(김철수)",
              "max": 200
            },
            "contactTel": {
              "type": "string",
              "label": "담당자 연락처 (숫자만)",
              "desc": "담당자 연락처 (숫자만)",
              "read": "담당자의 전화번호 — 숫자만(하이픈·괄호·공백 없이). 사무실 번호가 있으면 그것, 없으면 휴대전화.",
              "example": "0515101234",
              "max": 200
            },
            "subject": {
              "type": "string",
              "label": "외부강의등 주제",
              "desc": "외부강의등 주제",
              "read": "강의·자문·심사·발표의 주제 — 문서에 적힌 제목 그대로. 같은 건으로 여러 날 나눠 하면 실시 일자를 뒤에 괄호로 붙입니다.",
              "example": "MVDC 차단기 기술 특강",
              "max": 400
            },
            "place": {
              "type": "string",
              "label": "장소",
              "desc": "장소",
              "read": "실시 장소 — 기관·건물·호실. 온라인이면 화상회의·온라인강의·서면제출 가운데 맞는 말입니다(신고서가 그렇게 적으라고 합니다).",
              "example": "부산대학교 공학관 301호",
              "max": 200
            },
            "from": {
              "type": "date",
              "label": "시작일",
              "desc": "시작일",
              "read": "외부활동의 첫날. 연도가 적혀 있지 않으면 문서 발행일(없으면 오늘)의 연도를 붙입니다.",
              "example": "2026-11-05"
            },
            "to": {
              "type": "date",
              "label": "종료일",
              "desc": "종료일",
              "read": "외부활동의 마지막 날 — 하루면 시작일과 같은 날입니다.",
              "example": "2026-11-05"
            },
            "start": {
              "type": "time",
              "label": "시작 시간",
              "desc": "시작 시간",
              "read": "시작 시각 — 24시간 HH:MM(오후 2시는 14:00). 적혀 있지 않으면 null 입니다.",
              "example": "14:00"
            },
            "end": {
              "type": "time",
              "label": "종료 시간",
              "desc": "종료 시간",
              "read": "끝나는 시각 — 24시간 HH:MM. 시작 시각과 길이만 적혀 있으면 더해서 적고, 둘 다 없으면 null 입니다.",
              "example": "16:00"
            },
            "hours": {
              "type": "number",
              "label": "총 시간 (시간)",
              "desc": "총 시간 (시간)",
              "read": "총 시간 (시간) 칸",
              "min": 0
            },
            "mins": {
              "type": "number",
              "label": "총 시간 (분)",
              "desc": "총 시간 (분)",
              "read": "총 시간 (분) 칸",
              "min": 0
            },
            "fee": {
              "type": "number",
              "label": "사례금 총액 (원, 없으면 0)",
              "desc": "사례금 총액 (원, 없으면 0)",
              "read": "사례금(강사료·자문료·심사료) 총액 — 교통비·숙박비·식비는 빼고 원 단위입니다. 적혀 있지 않으면 null 입니다.",
              "example": 300000,
              "min": 0
            },
            "expenses": {
              "type": "number",
              "label": "교통비·숙박비·식비 (실비, 원)",
              "desc": "교통비·숙박비·식비 (실비, 원)",
              "read": "사례금과 따로 받는 교통비·숙박비·식비(실비) — 적혀 있으면 그 금액, 없으면 null 입니다.",
              "example": 50000,
              "min": 0
            },
            "rank": {
              "type": "string",
              "label": "직급",
              "desc": "직급",
              "read": "직급 칸",
              "max": 200
            },
            "monthCount": {
              "type": "number",
              "label": "당월 누적 (이번 포함 횟수)",
              "desc": "당월 누적 (이번 포함 횟수)",
              "read": "당월 누적 (이번 포함 횟수) 칸",
              "min": 0
            },
            "yearTotal": {
              "type": "number",
              "label": "당해 연도 사례금 누적 합계 (원, 이번 포함)",
              "desc": "당해 연도 사례금 누적 합계 (원, 이번 포함)",
              "read": "당해 연도 사례금 누적 합계 (원, 이번 포함) 칸",
              "min": 0
            },
            "note": {
              "type": "string",
              "label": "비고",
              "desc": "비고",
              "read": "비고 칸",
              "max": 1000
            },
            "currency": {
              "type": "enum",
              "label": "화폐",
              "desc": "합계의 화폐 — 원화가 아니면 합계를 원화로 고쳐 적는다(src/gongmun.js fromRecord 의 알림)",
              "read": "문서의 화폐(ISO 세 글자 코드). 원화 문서면 KRW",
              "default": "KRW",
              "values": [
                "KRW",
                "USD",
                "EUR",
                "JPY",
                "CNY",
                "GBP"
              ]
            },
            "attach": {
              "type": "list",
              "label": "첨부",
              "desc": "첨부 목록 — 문서 이름마다 그 문서로 묶는 파일 이름들(src/gongmun.js attachList — 레시피 attach_rules.yaml 의 parts)",
              "read": "첨부 문서마다 이름과 그 문서로 묶는 파일 이름들",
              "max": 20,
              "item": {
                "label": {
                  "type": "string",
                  "required": true,
                  "desc": "첨부 목록의 문서 이름(견적서·교육 안내 …)",
                  "read": "첨부 목록에 적는 문서 이름",
                  "max": 100
                },
                "files": {
                  "type": "tags",
                  "desc": "그 문서로 묶는 파일 이름들(자유 글의 목록 — values 없음)",
                  "read": "그 문서로 묶는 파일 이름들. 모르면 빈 목록"
                }
              }
            }
          }
        },
        "rank": {
          "type": "enum",
          "label": "전결권자",
          "desc": "이 공문에서 사람이 고른 전결권자 직책(registries/delegation.yaml 의 ranks). 비면 규정대로(레시피 purpose.yaml 의 rule_key — 구매·구매의뢰·교육은 연구비집행 금액 구간, 출장은 국내·해외, 외부활동은 팀장). 고르면 그것이 이긴다(delegationOf 의 overridden)",
          "read": "사용자가 전결권자(팀장·소장·본부장)를 말했을 때만. 그 밖에는 null(규정대로)",
          "llm": true,
          "ui": true,
          "values": [
            "팀장",
            "소장",
            "본부장"
          ]
        },
        "setting": {
          "type": "object",
          "label": "문서설정",
          "desc": "이 공문에서 바꾼 문서설정만(없는 키는 레시피 프로파일·공문 설정대로 — docSettingOf). 전자결재 툴바의 '문서설정' 창에 넣는 값이다",
          "read": "사용자가 문서설정(보존년한·수신처·공개범위·긴급·검색 키워드 등)을 바꾸라고 했을 때만",
          "llm": false,
          "ui": true,
          "fields": {
            "retention": {
              "type": "enum",
              "desc": "보존년한 코드(1년·2년·3년·5년·10년·20년·영구 — settings.yaml options.retention. 품의는 10년, 신고서·구매요청서는 3년이 기본)",
              "read": "보존년한을 말했으면 그 코드(10년이면 120, 3년이면 36)",
              "values": [
                "12",
                "24",
                "36",
                "60",
                "120",
                "240",
                "1200"
              ]
            },
            "docNo": {
              "type": "string",
              "desc": "문서번호 부서 코드(Doc No. — ddlDocNo 의 값, 숫자만)",
              "read": "문서번호 부서를 코드로 말했을 때만",
              "max": 8
            },
            "receiver": {
              "type": "enum",
              "desc": "수신처(settings.yaml options.receiver — 부서는 receivers 의 코드로 SetReceiverValue. 구매요청서는 프로파일이 총무팀)",
              "read": "수신처를 말했을 때만 — 내부결재·KRE·총무팀",
              "values": [
                "내부결재",
                "KRE",
                "총무팀"
              ]
            },
            "scope": {
              "type": "enum",
              "desc": "공개범위(settings.yaml options.scope — 결재선 YNN·기안부서 NNY)",
              "read": "공개범위를 말했을 때만 — 결재선 또는 기안부서",
              "values": [
                "결재선",
                "기안부서"
              ]
            },
            "emergency": {
              "type": "boolean",
              "desc": "긴급",
              "read": "긴급이라고 했을 때만 true"
            },
            "approvingOpen": {
              "type": "boolean",
              "desc": "진행공개",
              "read": "진행공개라고 했을 때만 true"
            },
            "drm": {
              "type": "boolean",
              "desc": "DRM",
              "read": "DRM 을 걸라고 했을 때만 true"
            },
            "tag": {
              "type": "string",
              "desc": "검색 키워드(비면 프로파일대로 — 구매·구매의뢰·교육은 고른 과제의 별명, 출장은 '출장', 외부활동은 '외부활동'. 2026-10-12 사용자 지정 \"연구개발 별칭이 있다면 그걸 넣어줘, 외부활동이면 외부활동, 출장이면 출장\")",
              "read": "검색 키워드를 말했을 때만",
              "max": 60
            }
          }
        },
        "attach": {
          "type": "list",
          "label": "첨부",
          "desc": "첨부 파일 이름(바이트는 ctx.files — 이름으로 잇는다). 읽은 문서를 첨부 목록의 문서마다 PDF 로 묶은 것과 원본 첨부. 견적서를 오렸으면(cut) 오린 그림이 앞에 온다",
          "read": "첨부할 문서의 파일 이름 목록. 지어내지 않습니다",
          "llm": false,
          "ui": true,
          "max": 5,
          "item": {
            "name": {
              "type": "string",
              "required": true,
              "desc": "파일 이름(견적서_업체_날짜.pdf 처럼 attachName 이 지은 것이거나 원본 이름)",
              "read": "파일 이름",
              "max": 200
            },
            "kind": {
              "type": "string",
              "desc": "무엇의 문서인지(첨부 목록의 문서 이름 — 견적서·거래명세서·교육 내용·행사 안내문·요청 공문 …, 원본 첨부면 original)",
              "read": "무엇의 문서인지. 모르면 null",
              "max": 40
            }
          }
        }
      },
      "checks": [],
      "rules": [],
      "llm": {
        "tasks": [
          {
            "task": "gongmun.outside",
            "fills": "draft"
          }
        ]
      },
      "runner": "gongmun.write",
      "uses": [
        {
          "module": "src/gongmun.js",
          "export": "writePlan"
        },
        {
          "module": "src/gmwrite.js",
          "export": "writeGongmun"
        }
      ],
      "then": [],
      "next": "뒤 탭에 신고서를 쓴다(제목·신고서 칸·문서설정·결재선·첨부 — 차수 칸이 없는 양식이라 제목만). ok 는 steps 에 ok false 가 없을 때다. 임시저장·상신은 사람이 창에서 한다"
    },
    "gongmun.prior": {
      "id": "gongmun.prior",
      "domain": "gongmun",
      "kind": "prior",
      "title": "선행 품의 읽기",
      "hint": "구매의뢰 초안",
      "status": "live",
      "confirm": false,
      "effect": "draft",
      "log": "gongmun",
      "summary": "선행 품의 {id} · {title}",
      "preset": {
        "me": {
          "from": "me",
          "desc": "기안자(내 이름 — 결재선의 기안, 과제책임자가 본인이면 합의를 뺀다)",
          "required": true
        },
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — writePlan 의 ctx.today(첨부 이름·본문 날짜 자리)"
        },
        "setup": {
          "from": "storage:gongmunPreset",
          "type": "object",
          "desc": "공문 설정(부서·부서장·소장·본부장·문서번호 부서 — 실명은 여기에만 둔다). 어댑터가 writePlan 의 ctx.preset 으로 그대로 넘긴다 — 문서번호·결재선이 여기서 나온다",
          "required": true
        }
      },
      "fields": {
        "id": {
          "type": "string",
          "required": true,
          "label": "문서번호",
          "desc": "선행 구매·구독 품의의 문서번호(공문 이력 줄의 id — HER-2026-000097 꼴). 본문 틀과 첨부 목록을 이 번호로 연다(src/gmlist.js bodyUrl · src/gmprior.js attachListUrl)",
          "read": "선행 품의의 문서번호(HER-2026-000097 꼴)",
          "llm": true,
          "ui": true,
          "example": "HER-2026-000097",
          "max": 40
        },
        "form": {
          "type": "string",
          "label": "양식",
          "desc": "그 문서의 eclass 양식 ID(공문 이력 줄의 form — 연구업무추진품의 KR_EA_Research_Task)",
          "read": "양식 ID — 연구업무추진품의(KR_EA_Research_Task)가 보통",
          "llm": true,
          "ui": true,
          "default": "KR_EA_Research_Task",
          "max": 60
        },
        "title": {
          "type": "string",
          "label": "제목",
          "desc": "그 문서의 제목(공문 이력 줄). 품목이 없을 때 품목 요지를 제목에서 뽑고(src/gmprior.js titleGist), 별명으로 과제를 고르며, 구매의뢰 초안의 선행 품의 제목 칸(sourceTitle)이 된다",
          "read": "선행 품의의 제목",
          "llm": true,
          "ui": true,
          "max": 200
        }
      },
      "checks": [],
      "rules": [],
      "llm": false,
      "runner": "gongmun.prior",
      "uses": [
        {
          "module": "src/gmprior.js",
          "export": "readPrior"
        },
        {
          "module": "src/gmprior.js",
          "export": "priorToPurchase"
        },
        {
          "module": "src/gmprior.js",
          "export": "priorProject"
        },
        {
          "module": "src/gongmun.js",
          "export": "orderFromPurchase"
        }
      ],
      "then": [],
      "next": "결과({ draft(구매의뢰 초안 — 품목·합계·구매처·사업내용·선행 품의 칸), purchase(구매 초안 꼴), project(고른 과제 이름), files(첨부 — 이름·형식·바이트), notes, doc })로 패널이 구매의뢰 갈래의 작업(st.work.order)을 세운다 → 사람이 계정과목·I/O·납품장소를 확인하고 공문 작성(gongmun.order)을 누른다"
    },
    "home.evidence": {
      "id": "home.evidence",
      "domain": "home",
      "kind": "evidence",
      "title": "홈 카드 증빙 받기",
      "status": "planned",
      "confirm": true,
      "effect": "draft",
      "log": "trip",
      "summary": "홈 카드에서 받은 증빙 {name} · {docNo}",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD)"
        },
        "me": {
          "from": "me",
          "desc": "내 이름 — 여비계산서 목록이 아는 이름(stages.me)이 비었을 때 대신. intakeEvidence·afterUp·receiptSmart 의 me"
        }
      },
      "fields": {
        "docNo": {
          "type": "string",
          "required": true,
          "label": "신청서 번호",
          "desc": "그 출장의 HR 신청서 번호(보관함의 열쇠)",
          "read": "그 출장의 HR 신청서 번호",
          "llm": true,
          "ui": true,
          "example": "2026-001234",
          "max": 20
        },
        "name": {
          "type": "string",
          "required": true,
          "label": "파일 이름",
          "desc": "받은 파일의 이름(file.name 과 같다 — 활동 로그 한 줄용. 같은 이름의 다른 그림은 담을 때 번호가 붙는다, uniqueName)",
          "read": "파일 이름 그대로",
          "llm": false,
          "ui": true,
          "max": 200
        },
        "file": {
          "type": "file",
          "required": true,
          "label": "증빙 파일",
          "desc": "받은 파일의 참조(이름·형식·크기 — 바이트는 ctx.files)",
          "read": "증빙 파일의 이름과 형식. 지어내지 않습니다",
          "llm": false,
          "ui": true
        },
        "trip": {
          "type": "object",
          "required": true,
          "label": "여비계산서",
          "desc": "그 출장의 여비계산서(목록 줄에서 — 번호·출장기간·출장지. intakeEvidence 의 trip — periodMiss 의 기준)",
          "read": "그 출장의 여비계산서 번호와 기간·출장지. 목록에 있는 것 그대로",
          "llm": true,
          "ui": true,
          "fields": {
            "seq": {
              "type": "string",
              "desc": "여비계산서 번호",
              "read": "여비계산서 번호",
              "example": "145580",
              "max": 20
            },
            "from": {
              "type": "date",
              "required": true,
              "desc": "출장 시작일",
              "read": "출장 시작일(YYYY-MM-DD)",
              "example": "2026-10-20"
            },
            "to": {
              "type": "date",
              "desc": "출장 종료일(당일이면 시작일)",
              "read": "출장 종료일(YYYY-MM-DD)",
              "example": "2026-10-21"
            },
            "location": {
              "type": "string",
              "desc": "출장지(\"출장지(장소)\")",
              "read": "출장지",
              "example": "대전(한국기계연구원)",
              "max": 200
            }
          }
        },
        "settled": {
          "type": "boolean",
          "label": "사후정산 완료됨",
          "desc": "사후정산이 완료된 출장인가 — 참이면 읽지 않고 보낼 증빙(label 증빙)으로만 담는다",
          "read": "사후정산이 이미 완료된 출장이면 true",
          "llm": false,
          "ui": true
        }
      },
      "checks": [],
      "rules": [],
      "llm": false,
      "runner": "home.evidence",
      "uses": [
        {
          "module": "src/intake.js",
          "export": "intakeEvidence"
        },
        {
          "module": "src/evidence.js",
          "export": "createEvidenceStore"
        },
        {
          "module": "src/llm.js",
          "export": "receiptSmart"
        }
      ],
      "then": [
        {
          "action": "home.afterup",
          "when": "!settled"
        }
      ],
      "next": "결과({ ok, kept, name, label, note, warn, todo })를 출장 줄에 적는다. todo(사후정산에 올릴 숙박 증빙·항공권)가 하나라도 있으면 홈 카드가 home.afterup 을 잇는다(같은 누름 — 다 담은 뒤 한 번)"
    },
    "home.afterup": {
      "id": "home.afterup",
      "domain": "home",
      "kind": "afterup",
      "title": "홈에서 사후정산 올리기",
      "status": "planned",
      "confirm": true,
      "effect": "write",
      "log": "trip",
      "summary": "홈 카드 사후정산 올리기 {seq} · {docNo}",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD)"
        },
        "me": {
          "from": "me",
          "desc": "내 이름 — 여비계산서 목록이 아는 이름(stages.me)이 비었을 때 대신. intakeEvidence·afterUp·receiptSmart 의 me"
        }
      },
      "fields": {
        "docNo": {
          "type": "string",
          "required": true,
          "label": "신청서 번호",
          "desc": "그 출장의 HR 신청서 번호(보관함의 열쇠 — todo 증빙을 여기서 꺼낸다)",
          "read": "그 출장의 HR 신청서 번호",
          "llm": true,
          "ui": true,
          "example": "2026-001234",
          "max": 20
        },
        "seq": {
          "type": "string",
          "required": true,
          "label": "계산서 번호",
          "desc": "그 출장의 여비계산서 번호(목록 줄 row — 어댑터가 ctx.row 와 같은지 본다. 단계·출장자 번호는 지금 것을 다시 읽는다)",
          "read": "여비계산서 번호",
          "llm": true,
          "ui": true,
          "example": "145580",
          "max": 20
        },
        "settle": {
          "type": "list",
          "label": "숙박 줄의 결정",
          "desc": "상한액을 넘는 숙박 줄마다 사람이 고른 것(afterUp 의 settle — lodgeKey → cap·real). 처음에는 비어 있고 ask 에 답한 뒤 담긴다",
          "read": "사용자가 그 숙박을 상한액으로 할지 실제 금액으로 할지 말했을 때만",
          "llm": false,
          "ui": true,
          "max": 10,
          "item": {
            "key": {
              "type": "string",
              "required": true,
              "desc": "어느 숙박 줄인가 — 그 줄의 증빙 파일 이름들(src/afterup.js lodgeKey)",
              "read": "그 숙박 줄의 증빙 파일 이름(여럿이면 ' | ' 로 이어서)",
              "max": 400
            },
            "settle": {
              "type": "enum",
              "required": true,
              "desc": "상한액으로(cap) · 실제 금액으로(real — 1.5배 이내면 부서장 승인)",
              "read": "상한액으로 하겠다면 cap, 실제 금액으로 하겠다면 real",
              "values": [
                "cap",
                "real"
              ]
            }
          }
        }
      },
      "checks": [],
      "rules": [],
      "llm": false,
      "runner": "home.afterup",
      "uses": [
        {
          "module": "src/afterup.js",
          "export": "afterUp"
        },
        {
          "module": "src/after.js",
          "export": "afterPlan"
        },
        {
          "module": "src/after.js",
          "export": "lodgeChoices"
        }
      ],
      "then": [],
      "next": "결과({ ok, sent, hold, text, brief, ask })를 출장 줄에 적는다. ask 가 있으면 줄에 고르는 버튼이 서고 고르면 settle 을 담아 다시 짓는다. 올렸으면 가는 편·오는 편(attendLegs)과 올린 숙박 줄의 표시(attendLodgeMine·attendLodgeActual)를 적어 둔다(remember)"
    },
    "home.receipt": {
      "id": "home.receipt",
      "domain": "home",
      "kind": "receipt",
      "title": "증빙 한 장 읽기",
      "status": "planned",
      "confirm": false,
      "effect": "none",
      "log": "trip",
      "summary": "증빙 읽기 {name}",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD)"
        },
        "me": {
          "from": "me",
          "desc": "내 이름 — 여비계산서 목록이 아는 이름(stages.me)이 비었을 때 대신. intakeEvidence·afterUp·receiptSmart 의 me"
        }
      },
      "fields": {
        "name": {
          "type": "string",
          "required": true,
          "label": "파일 이름",
          "desc": "읽을 파일의 이름(file.name — 활동 로그 한 줄용)",
          "read": "파일 이름 그대로",
          "llm": false,
          "ui": true,
          "max": 200
        },
        "file": {
          "type": "file",
          "required": true,
          "label": "증빙 파일",
          "desc": "읽을 파일의 참조(이름·형식·크기 — 바이트는 ctx.files. 이미지·PDF)",
          "read": "증빙 파일의 이름과 형식. 지어내지 않습니다",
          "llm": false,
          "ui": true
        },
        "trip": {
          "type": "object",
          "label": "출장",
          "desc": "출장 정보(기간·출장지·번호 — receiptInput 이 입력 글에 적는다. 출장지에서 결제했는지(atDestination)의 기준)",
          "read": "그 출장의 기간과 출장지. 화면에 있는 것 그대로",
          "llm": true,
          "ui": true,
          "fields": {
            "seq": {
              "type": "string",
              "desc": "여비계산서 번호",
              "read": "여비계산서 번호",
              "example": "145580",
              "max": 20
            },
            "from": {
              "type": "date",
              "desc": "출장 시작일",
              "read": "출장 시작일(YYYY-MM-DD)",
              "example": "2026-10-20"
            },
            "to": {
              "type": "date",
              "desc": "출장 종료일",
              "read": "출장 종료일(YYYY-MM-DD)",
              "example": "2026-10-21"
            },
            "location": {
              "type": "string",
              "desc": "출장지",
              "read": "출장지",
              "example": "대전(한국기계연구원)",
              "max": 200
            }
          }
        }
      },
      "checks": [],
      "rules": [],
      "llm": false,
      "runner": "home.receipt",
      "uses": [
        {
          "module": "src/llm.js",
          "export": "receiptSmart"
        },
        {
          "module": "src/llm.js",
          "export": "receiptInput"
        }
      ],
      "then": [],
      "next": "{ ok, record, via, note } 를 돌려준다 — 화면 스크립트가 record 로 줄을 더해 칸만 채운다(src/afterpage.js fillPlan). 어느 길(cli·api)로 읽었는지가 via 다"
    },
    "mail.register": {
      "id": "mail.register",
      "domain": "mail",
      "kind": "register",
      "title": "보낸 메일 등록",
      "status": "planned",
      "confirm": true,
      "effect": "draft",
      "log": "mail",
      "summary": "메일 등록 {count}건",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — 보낸 메일 기간·zip 이름의 기준"
        }
      },
      "fields": {
        "count": {
          "type": "integer",
          "label": "건수",
          "desc": "등록하는 메일 수(mails 의 길이 — 활동 로그 한 줄용)",
          "read": "등록하는 메일의 수",
          "llm": false,
          "ui": true,
          "min": 1,
          "max": 50
        },
        "mails": {
          "type": "list",
          "label": "보낸 메일",
          "desc": "등록할 보낸 메일 — 등록 대화(sync.listSent)에서 고른 것. id 가 Outlook 메시지 id 다",
          "read": "사용자가 고른 보낸 메일. 제목으로 찾은 메일의 id 그대로 — 지어내지 않습니다",
          "llm": false,
          "ui": true,
          "max": 50,
          "item": {
            "id": {
              "type": "string",
              "required": true,
              "desc": "Outlook 메시지 id(sync.register 의 ids)",
              "read": "메시지 id 그대로",
              "max": 300
            },
            "subject": {
              "type": "string",
              "desc": "제목(기록용)",
              "read": "메일 제목",
              "max": 300
            }
          }
        }
      },
      "checks": [],
      "rules": [],
      "llm": false,
      "runner": "mail.register",
      "uses": [
        {
          "module": "mailtrack/sync.js",
          "export": "createSync"
        },
        {
          "module": "mailtrack/model.js",
          "export": "newItem"
        }
      ],
      "then": [],
      "next": "결과(added·skipped·errors·warnings)를 등록 대화와 활동 로그에 적고, 새로 등록했으면 mail.refresh 를 한 번 돈다(등록 전에 와 있던 회신이 바로 이어지게)"
    },
    "mail.refresh": {
      "id": "mail.refresh",
      "domain": "mail",
      "kind": "refresh",
      "title": "회신 갱신",
      "status": "planned",
      "confirm": false,
      "effect": "draft",
      "log": "mail",
      "summary": "메일 회신 갱신 ({why})",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — 보낸 메일 기간·zip 이름의 기준"
        }
      },
      "fields": {
        "force": {
          "type": "boolean",
          "label": "처음부터",
          "desc": "닫지 않은 모든 항목을 보낸 때부터 다시 훑는다(조회 창 windowDays 안에서)",
          "read": "처음부터 다시 찾으라고 했을 때만 true",
          "llm": true,
          "ui": true
        },
        "why": {
          "type": "string",
          "label": "까닭",
          "desc": "왜 갱신하는지(새로고침·등록 뒤·자동 — 상태 줄과 활동 로그)",
          "read": "왜 갱신하는지 짧게. 모르면 null",
          "llm": false,
          "ui": true,
          "max": 40
        }
      },
      "checks": [],
      "rules": [],
      "llm": false,
      "runner": "mail.refresh",
      "uses": [
        {
          "module": "mailtrack/sync.js",
          "export": "createSync"
        },
        {
          "module": "mailtrack/model.js",
          "export": "sinceOf"
        }
      ],
      "then": [],
      "next": "결과(fetched·linked·warnings 또는 error — 연결 칩이 그에 맞춰진다)를 머리에 적는다. 갱신이 됐으면 꺼짐·로그인 필요로 남아 있던 칩을 되돌린다"
    },
    "mail.delete": {
      "id": "mail.delete",
      "domain": "mail",
      "kind": "delete",
      "title": "메일 등록 지우기",
      "status": "planned",
      "confirm": true,
      "effect": "draft",
      "log": "mail",
      "summary": "메일 등록 지움 {subject}",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — 보낸 메일 기간·zip 이름의 기준"
        }
      },
      "fields": {
        "itemId": {
          "type": "string",
          "required": true,
          "label": "항목",
          "desc": "지울 항목의 id(= 보낸 메일의 Outlook 메시지 id)",
          "read": "지울 항목의 id — 보고 있는 메일 그대로",
          "llm": false,
          "ui": true,
          "max": 300
        },
        "subject": {
          "type": "string",
          "label": "제목",
          "desc": "그 메일의 제목(기록용 — 어댑터가 id 의 항목과 같은지 본다)",
          "read": "그 메일의 제목",
          "llm": true,
          "ui": true,
          "max": 300
        }
      },
      "checks": [],
      "rules": [],
      "llm": false,
      "runner": "mail.delete",
      "uses": [
        {
          "module": "mailtrack/sync.js",
          "export": "createSync"
        }
      ],
      "then": [],
      "next": "목록으로 돌아가고 상태 줄에 지웠다고 적는다. 금고 지우기가 실패해도 장부에서는 지운다(sync 가 기록만 남긴다)"
    },
    "mail.merge": {
      "id": "mail.merge",
      "domain": "mail",
      "kind": "merge",
      "title": "양식 병합",
      "status": "planned",
      "confirm": true,
      "effect": "draft",
      "log": "mail",
      "summary": "양식 병합 {kind} · 회신 {count}건",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — 보낸 메일 기간·zip 이름의 기준"
        }
      },
      "fields": {
        "itemId": {
          "type": "string",
          "required": true,
          "label": "항목",
          "desc": "병합할 항목의 id(보낸 메일)",
          "read": "보고 있는 메일의 id",
          "llm": false,
          "ui": true,
          "max": 300
        },
        "templateAttachmentId": {
          "type": "string",
          "required": true,
          "label": "양식",
          "desc": "내가 보낸 양식 첨부의 id(항목의 templates[].attachmentId — 비면 첫 양식)",
          "read": "병합할 양식 첨부의 id",
          "llm": false,
          "ui": true,
          "max": 300
        },
        "kind": {
          "type": "enum",
          "required": true,
          "label": "갈래",
          "desc": "양식의 갈래(mergeKind — 옛 이진 형식 xls·doc 과 매크로 파일은 받지 않는다)",
          "read": "엑셀이면 xlsx, 워드면 docx",
          "llm": true,
          "ui": true,
          "values": [
            "xlsx",
            "docx"
          ]
        },
        "count": {
          "type": "integer",
          "label": "회신 수",
          "desc": "합치는 회신 첨부 수(picks 의 길이 — 활동 로그 한 줄용)",
          "read": "합치는 회신 첨부의 수",
          "llm": false,
          "ui": true,
          "min": 1,
          "max": 50
        },
        "picks": {
          "type": "list",
          "label": "합칠 회신 첨부",
          "desc": "합칠 회신 첨부(사람이 끈 것은 빠진다 — mergeOff). 같은 갈래로 금고에 있는 것만",
          "read": "사용자가 합치라고 고른 회신 첨부. 지어내지 않습니다",
          "llm": false,
          "ui": true,
          "max": 50,
          "item": {
            "messageId": {
              "type": "string",
              "required": true,
              "desc": "회신의 메시지 id",
              "read": "회신 메시지 id",
              "max": 300
            },
            "attachmentId": {
              "type": "string",
              "required": true,
              "desc": "그 회신의 첨부 id",
              "read": "첨부 id",
              "max": 300
            }
          }
        },
        "headerRows": {
          "type": "string",
          "label": "머리글 줄",
          "desc": "xlsx — 머리글 줄 수(auto 또는 1 이상의 수)",
          "read": "엑셀의 머리글이 몇 줄인지 말했으면 그 수, 아니면 auto",
          "llm": true,
          "ui": true,
          "when": "kind=xlsx",
          "default": "auto",
          "max": 10
        },
        "mode": {
          "type": "enum",
          "label": "합치는 법",
          "desc": "docx — 쌓기(stack) 또는 표 줄로(rows)",
          "read": "워드를 표의 줄로 합치라면 rows, 아니면 stack",
          "llm": true,
          "ui": true,
          "when": "kind=docx",
          "default": "stack",
          "values": [
            "stack",
            "rows"
          ]
        }
      },
      "checks": [],
      "rules": [],
      "llm": false,
      "runner": "mail.merge",
      "uses": [
        {
          "module": "mailtrack/sync.js",
          "export": "createSync"
        },
        {
          "module": "mailtrack/ooxml/merge.js",
          "export": "mergeOffice"
        },
        {
          "module": "mailtrack/ooxml/merge.js",
          "export": "mergedName"
        }
      ],
      "then": [],
      "next": "합친 파일({ name, bytes, mime })을 내려받고 report(merged·rows·skipped·warnings)를 병합 칸에 적는다"
    },
    "mail.settings": {
      "id": "mail.settings",
      "domain": "mail",
      "kind": "settings",
      "title": "메일 설정 바꾸기",
      "status": "planned",
      "confirm": false,
      "effect": "draft",
      "log": "mail",
      "summary": "메일 설정 바꿈",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — 보낸 메일 기간·zip 이름의 기준"
        }
      },
      "fields": {
        "patch": {
          "type": "object",
          "label": "바꾼 설정",
          "desc": "바꾼 칸만(model.js DEFAULTS 의 키 — 없는 키는 그대로)",
          "read": "사용자가 바꾸라고 한 설정 칸만",
          "llm": true,
          "ui": true,
          "fields": {
            "mcpUrl": {
              "type": "string",
              "desc": "Outlook MCP 주소(기본 http://localhost:5001/mcp — checkMcpUrl 이 꼴을 본다)",
              "read": "MCP 서버 주소를 말했을 때만",
              "max": 200
            },
            "userEmail": {
              "type": "string",
              "desc": "내 메일 주소(비면 처음 등록한 보낸 메일의 보낸 주소)",
              "read": "내 메일 주소를 말했을 때만",
              "max": 200
            },
            "sentDays": {
              "type": "integer",
              "desc": "등록 대화의 보낸 메일 기간(일 — 7·14·30·60)",
              "read": "보낸 메일을 며칠까지 보일지 말했을 때만",
              "min": 1,
              "max": 365
            },
            "windowDays": {
              "type": "integer",
              "desc": "회신 조회 창(일)",
              "read": "회신을 며칠까지 찾을지 말했을 때만",
              "min": 1,
              "max": 365
            },
            "ownByAddress": {
              "type": "boolean",
              "desc": "내 도메인은 주소마다 받을 곳으로 세운다(거짓이면 도메인마다)",
              "read": "같은 회사 사람을 따로 센다고 했을 때 true"
            },
            "useHeaders": {
              "type": "boolean",
              "desc": "받은 메일을 헤더로 잇는다(In-Reply-To·References)",
              "read": "헤더로 잇는다고 했을 때 true"
            },
            "autoRefreshMin": {
              "type": "integer",
              "desc": "자동 갱신 간격(분 — 0 이면 끔)",
              "read": "자동 갱신 간격(분)을 말했을 때만",
              "min": 0,
              "max": 1440
            },
            "requireAccept": {
              "type": "boolean",
              "desc": "회신이 와도 수락해야 센다(2026-10-15 사용자 지정 \"받은거 accept 할지 거부할지\")",
              "read": "수락해야 센다고 했을 때 true"
            }
          }
        }
      },
      "checks": [],
      "rules": [],
      "llm": false,
      "runner": "mail.settings",
      "uses": [
        {
          "module": "mailtrack/sync.js",
          "export": "createSync"
        },
        {
          "module": "mailtrack/model.js",
          "export": "normalizeSettings"
        },
        {
          "module": "mailtrack/panel.js",
          "export": "checkMcpUrl"
        }
      ],
      "then": [],
      "next": "장부를 다시 그리고 저장했다고 적는다. 서버 주소·계정을 바꿨으면 연결을 다시 확인한다(runProbe)"
    },
    "rnd.project": {
      "id": "rnd.project",
      "domain": "rnd",
      "kind": "project",
      "title": "R&D 과제 더하기·고치기",
      "status": "planned",
      "confirm": true,
      "effect": "draft",
      "log": "rnd",
      "summary": "R&D 과제 {name} ({alias})",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — 차년도(오늘이 든 것)·변경이력 날짜·zip 이름"
        },
        "me": {
          "from": "me",
          "desc": "내 이름 — 연구내용 페이지의 올린 사람(by)"
        }
      },
      "fields": {
        "id": {
          "type": "string",
          "label": "과제 id",
          "desc": "고치는 과제의 id(src/rnd.js newId). 비면 새 과제",
          "read": "고치는 과제의 id. 새 과제면 null",
          "llm": false,
          "ui": true,
          "max": 40
        },
        "name": {
          "type": "string",
          "required": true,
          "label": "과제명",
          "desc": "과제명(전자결재 과제 찾기에 그대로 쓴다)",
          "read": "과제명 — 글에 적힌 그대로",
          "llm": true,
          "ui": true,
          "example": "MW급 10kV 고전압 직류 시스템용 반도체 차단기 개발",
          "max": 200
        },
        "alias": {
          "type": "string",
          "required": true,
          "label": "별칭",
          "desc": "별칭(칩·머리·교육/출장 품의 제목의 과제 별명 — 과제끼리 겹치지 않는다, aliasOwner)",
          "read": "과제 별명(약칭). \"별명\"·\"약칭\" 으로 적혔거나 사용자가 정한 것",
          "llm": true,
          "ui": true,
          "example": "차단기 과제",
          "max": 60
        },
        "code": {
          "type": "string",
          "label": "과제번호",
          "desc": "과제번호(rERP 잇기의 열쇠 — 국가과제 번호 RS-… 일 수 있다)",
          "read": "과제번호",
          "llm": true,
          "ui": true,
          "example": "RND-20-2026",
          "max": 40
        },
        "job": {
          "type": "string",
          "label": "Job Id",
          "desc": "전자결재 공문의 과제 찾기 번호(R&D PMS 의 Project_ID — RND00202026 꼴). 비우면 공문 작성 때 책임자·과제명 유사도로 고른다(src/gmwrite.js)",
          "read": "사내 과제 Job Id(RND00202026 · RND-20-2026 꼴). 국가과제 번호(RS-…)는 아니다. 적혀 있지 않으면 null",
          "llm": true,
          "ui": true,
          "example": "RND00202026",
          "max": 20
        },
        "io": {
          "type": "string",
          "label": "회계 I/O",
          "desc": "회계(e-accounting)의 과제 코드(I/O — 2145NR0124 꼴). 구매요청서 예산 내역의 I/O 코드이고 계정과목별 예산 조회의 열쇠. 비우면 과제 정보 카드가 회계의 과제 목록에서 과제명 유사도로 찾는다(src/eacct.js rankIo)",
          "read": "회계 I/O 코드(네 자리 숫자 + 영문 둘 + 네 자리 — 2145NR0124 꼴). Job Id(RND…)·국가과제 번호(RS-…)는 아니다. 적혀 있지 않으면 null",
          "llm": true,
          "ui": true,
          "example": "2145NR0124",
          "max": 20
        },
        "lead": {
          "type": "string",
          "label": "책임자",
          "desc": "과제책임자(품의의 합의자)",
          "read": "과제책임자 이름 — 직급·존칭은 뗀다",
          "llm": true,
          "ui": true,
          "example": "박기도",
          "max": 40
        },
        "start": {
          "type": "date",
          "label": "시작일",
          "desc": "연구 시작일(차년도를 자르는 기준)",
          "read": "연구기간의 시작일(YYYY-MM-DD)",
          "llm": true,
          "ui": true,
          "example": "2026-04-01"
        },
        "end": {
          "type": "date",
          "label": "종료일",
          "desc": "연구 종료일(시작일보다 앞서면 버린다 — normalizeProject)",
          "read": "연구기간의 종료일(YYYY-MM-DD)",
          "llm": true,
          "ui": true,
          "example": "2029-12-31"
        },
        "calendar": {
          "type": "boolean",
          "label": "차년도 기준",
          "desc": "차년도를 1월 1일로 자르는가(첫 해는 시작일부터 12월 31일까지). 거짓이면 시작일부터 한 해씩(src/rnd.js calendarLabel)",
          "read": "차년도를 1월 1일 기준으로 센다고 했을 때만 true",
          "llm": true,
          "ui": true,
          "default": false
        },
        "note": {
          "type": "string",
          "label": "메모",
          "desc": "과제 메모",
          "read": "과제에 적어 둘 메모. 말하지 않았으면 null",
          "llm": true,
          "ui": true,
          "max": 1000
        }
      },
      "checks": [
        {
          "left": "start",
          "op": "<=",
          "right": "end",
          "drop": "end",
          "message": "종료일이 시작일보다 앞서 종료일은 뺐습니다"
        }
      ],
      "rules": [],
      "llm": false,
      "runner": "rnd.project",
      "uses": [
        {
          "module": "src/rnd.js",
          "export": "normalizeProject"
        },
        {
          "module": "src/rnd.js",
          "export": "projectChanges"
        },
        {
          "module": "src/rnd.js",
          "export": "aliasOwner"
        }
      ],
      "then": [],
      "next": "장부(rndBook)에 넣고 저장한다(rndpanel.js save). 원노트 공유가 켜져 있으면 잠깐 뒤 rnd.note.sync 가 따라온다(noteSoon)"
    },
    "rnd.delete": {
      "id": "rnd.delete",
      "domain": "rnd",
      "kind": "delete",
      "title": "R&D 과제 지우기",
      "status": "planned",
      "confirm": true,
      "effect": "draft",
      "log": "rnd",
      "summary": "R&D 과제 지움 {name}",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — 차년도(오늘이 든 것)·변경이력 날짜·zip 이름"
        },
        "me": {
          "from": "me",
          "desc": "내 이름 — 연구내용 페이지의 올린 사람(by)"
        }
      },
      "fields": {
        "id": {
          "type": "string",
          "required": true,
          "label": "과제 id",
          "desc": "지울 과제의 id(장부 rndBook 의 projects[].id)",
          "read": "지울 과제의 id — 보고 있는 과제 그대로",
          "llm": false,
          "ui": true,
          "max": 40
        },
        "name": {
          "type": "string",
          "label": "과제명",
          "desc": "지울 과제의 이름(기록용 — 어댑터가 id 의 과제와 같은지 본다)",
          "read": "지울 과제의 이름",
          "llm": true,
          "ui": true,
          "example": "MW급 10kV 고전압 직류 시스템용 반도체 차단기 개발",
          "max": 200
        }
      },
      "checks": [],
      "rules": [],
      "llm": false,
      "runner": "rnd.delete",
      "uses": [
        {
          "module": "src/rnd.js",
          "export": "projectOf"
        }
      ],
      "then": [],
      "next": "장부에서 빼고 보고 있는 과제를 첫 과제로 옮겨 저장한다(rndpanel.js save)"
    },
    "rnd.yaml": {
      "id": "rnd.yaml",
      "domain": "rnd",
      "kind": "yaml",
      "title": "연구개발계획서 YAML 넣기",
      "status": "planned",
      "confirm": true,
      "effect": "draft",
      "log": "rnd",
      "summary": "R&D YAML 넣기 {count}건",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — 차년도(오늘이 든 것)·변경이력 날짜·zip 이름"
        },
        "me": {
          "from": "me",
          "desc": "내 이름 — 연구내용 페이지의 올린 사람(by)"
        },
        "current": {
          "from": "storage:rndBook.current.project",
          "desc": "보고 있는 과제의 id(이력 파일에 과제명이 없을 때 넣을 과제 — applyYaml 의 current)"
        }
      },
      "fields": {
        "count": {
          "type": "integer",
          "label": "파일 수",
          "desc": "넣는 YAML 글의 수(texts 의 길이 — 활동 로그 한 줄용)",
          "read": "넣는 YAML 파일의 수",
          "llm": false,
          "ui": true,
          "min": 1,
          "max": 20
        },
        "texts": {
          "type": "list",
          "label": "YAML 글",
          "desc": "넣는 YAML 글 — 파일마다 한 줄(이름과 글). RND 폴더의 KR_<과제>.yaml(스냅샷)이나 history/*.yaml(revisions·budget·researchers)",
          "read": "이 칸은 사용자의 말로 채우지 않습니다 — 넣은 파일의 글이 그대로 들어갑니다",
          "llm": false,
          "ui": true,
          "max": 20,
          "item": {
            "name": {
              "type": "string",
              "desc": "파일 이름(붙여 넣은 글이면 빈 글)",
              "read": "파일 이름",
              "max": 200
            },
            "text": {
              "type": "string",
              "required": true,
              "desc": "YAML 글 그대로(src/rndyaml.js 가 종류를 가린다)",
              "read": "YAML 글 그대로",
              "max": 300000
            }
          }
        }
      },
      "checks": [],
      "rules": [],
      "llm": false,
      "runner": "rnd.yaml",
      "uses": [
        {
          "module": "src/rndyaml.js",
          "export": "kindOf"
        },
        {
          "module": "src/rndyaml.js",
          "export": "applyYaml"
        }
      ],
      "then": [],
      "next": "하나라도 들어갔으면 장부를 다시 그리고 저장한다. 스냅샷을 넣었고 그 과제의 연구내용 페이지가 원노트에 있으면 rnd.research.share(auto)가 따라온다(기다리지 않는다)"
    },
    "rnd.erp.link": {
      "id": "rnd.erp.link",
      "domain": "rnd",
      "kind": "erp.link",
      "title": "rERP 잇기",
      "status": "planned",
      "confirm": true,
      "effect": "draft",
      "log": "rnd",
      "summary": "rERP 잇기 {projectId} {year}차년도 → {prjNo}",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — 차년도(오늘이 든 것)·변경이력 날짜·zip 이름"
        },
        "me": {
          "from": "me",
          "desc": "내 이름 — 연구내용 페이지의 올린 사람(by)"
        },
        "erp": {
          "from": "storage:rndSettings",
          "type": "object",
          "desc": "R&D 설정(rERP 집행내역 켬·숨긴 비목·더하기 — src/rnderp.js SET_KEY). 꺼져 있으면 잇지 않는다"
        }
      },
      "fields": {
        "projectId": {
          "type": "string",
          "required": true,
          "label": "과제 id",
          "desc": "보고 있는 과제의 id",
          "read": "보고 있는 과제의 id",
          "llm": false,
          "ui": true,
          "max": 40
        },
        "year": {
          "type": "integer",
          "required": true,
          "label": "차년도",
          "desc": "보고 있는 차년도(n)",
          "read": "몇 차년도인지(1부터)",
          "llm": true,
          "ui": true,
          "example": 2,
          "min": 1,
          "max": 20
        },
        "prjNo": {
          "type": "string",
          "label": "rERP 과제번호",
          "desc": "고른 rERP 과제번호(목록에서 고른 것 — 비면 과제번호·과제명으로 저절로 찾는다. 끊을 때는 빈 글과 unlink)",
          "read": "사용자가 rERP 과제번호를 말했을 때만",
          "llm": true,
          "ui": true,
          "example": "P2026-012",
          "max": 40
        },
        "manual": {
          "type": "boolean",
          "label": "손으로 고름",
          "desc": "사람이 드롭다운에서 고른 것인가(linkOf 의 auto 반대 — 저절로 이은 것은 다음에 다시 찾는다)",
          "read": "사용자가 직접 골랐으면 true",
          "llm": false,
          "ui": true
        },
        "unlink": {
          "type": "boolean",
          "label": "끊기",
          "desc": "이어진 것을 끊는다(스냅샷을 버리고 맞춰진 비목의 집행은 다시 손으로 적는다 — 값은 남긴다)",
          "read": "끊으라고 했을 때만 true",
          "llm": true,
          "ui": true
        }
      },
      "checks": [],
      "rules": [],
      "llm": false,
      "runner": "rnd.erp.link",
      "uses": [
        {
          "module": "rerp/erp.js",
          "export": "fetchProjectRecs"
        },
        {
          "module": "src/rnderp.js",
          "export": "projectRecs"
        },
        {
          "module": "src/rnderp.js",
          "export": "pickYearRec"
        },
        {
          "module": "src/rnderp.js",
          "export": "candidates"
        },
        {
          "module": "src/rnderp.js",
          "export": "linkOf"
        }
      ],
      "then": [],
      "next": "이었으면 곧바로 집행내역을 받는다(rnd.erp.fetch force — 패널이 잇는다). 못 골랐으면 후보 목록을 보이고 사람이 고른 뒤 다시 짓는다"
    },
    "rnd.erp.fetch": {
      "id": "rnd.erp.fetch",
      "domain": "rnd",
      "kind": "erp.fetch",
      "title": "rERP 집행내역 받기",
      "status": "planned",
      "confirm": false,
      "effect": "draft",
      "log": "rnd",
      "summary": "rERP 집행내역 {prjNo} ({reason})",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — 차년도(오늘이 든 것)·변경이력 날짜·zip 이름"
        },
        "me": {
          "from": "me",
          "desc": "내 이름 — 연구내용 페이지의 올린 사람(by)"
        },
        "erp": {
          "from": "storage:rndSettings",
          "type": "object",
          "desc": "R&D 설정(rERP 집행내역 켬·숨긴 비목·더하기 — fetchSnapshot 의 settings). 꺼져 있으면 받지 않는다"
        }
      },
      "fields": {
        "projectId": {
          "type": "string",
          "required": true,
          "label": "과제 id",
          "desc": "보고 있는 과제의 id",
          "read": "보고 있는 과제의 id",
          "llm": false,
          "ui": true,
          "max": 40
        },
        "year": {
          "type": "integer",
          "required": true,
          "label": "차년도",
          "desc": "보고 있는 차년도(n — 조회 기간이 여기서 나온다)",
          "read": "몇 차년도인지(1부터)",
          "llm": true,
          "ui": true,
          "example": 2,
          "min": 1,
          "max": 20
        },
        "prjNo": {
          "type": "string",
          "required": true,
          "label": "rERP 과제번호",
          "desc": "이어 둔 rERP 과제번호(장부 erp.prjNo)",
          "read": "rERP 과제번호",
          "llm": true,
          "ui": true,
          "example": "P2026-012",
          "max": 40
        },
        "force": {
          "type": "boolean",
          "label": "다시 받기",
          "desc": "10분 안이어도·지난 차년도여도 다시 받는다(잇고 나서·새로고침)",
          "read": "새로 받으라고 했을 때만 true",
          "llm": true,
          "ui": true
        },
        "reason": {
          "type": "string",
          "label": "까닭",
          "desc": "왜 받는지(잇기·고름·새로고침·탭 열기 — 활동 로그 한 줄에 적힌다)",
          "read": "왜 받는지 짧게. 모르면 null",
          "llm": false,
          "ui": true,
          "max": 40
        }
      },
      "checks": [],
      "rules": [],
      "llm": false,
      "runner": "rnd.erp.fetch",
      "uses": [
        {
          "module": "src/rnderp.js",
          "export": "fetchSnapshot"
        },
        {
          "module": "src/rnderp.js",
          "export": "applySnapshot"
        },
        {
          "module": "src/rnderp.js",
          "export": "isFresh"
        }
      ],
      "then": [],
      "next": "스냅샷을 장부 줄에 넣고(applyErp) 합계를 다시 그린다. 실패하면 erp.error 를 두고 칸에 까닭을 보인다"
    },
    "rnd.note.sync": {
      "id": "rnd.note.sync",
      "domain": "rnd",
      "kind": "note.sync",
      "title": "원노트 과제 정보 맞추기",
      "status": "planned",
      "confirm": false,
      "effect": "write",
      "log": "rnd",
      "summary": "원노트 과제 정보 맞춤 ({reason})",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — 차년도(오늘이 든 것)·변경이력 날짜·zip 이름"
        },
        "me": {
          "from": "me",
          "desc": "내 이름 — 연구내용 페이지의 올린 사람(by)"
        },
        "note": {
          "from": "storage:rndNote",
          "type": "object",
          "desc": "원노트 공유 설정과 지난 맞춤의 손잡이(on·sectionId·sectionLabel·pageId·webUrl·memo·del·at — src/rndnote.js normalizeNote). syncInfo 의 memo·del 이 여기서 온다"
        }
      },
      "fields": {
        "sectionId": {
          "type": "string",
          "required": true,
          "label": "섹션",
          "desc": "과제 정보를 둘 OneNote 섹션 id(설정에서 고른 것 — 다른 기기도 같은 섹션)",
          "read": "사용자가 섹션을 골랐을 때 그 id",
          "llm": false,
          "ui": true,
          "max": 200
        },
        "reason": {
          "type": "string",
          "label": "까닭",
          "desc": "왜 맞추는지(켬·섹션 고름·고침·탭 열기·다시 — 활동 로그 한 줄)",
          "read": "왜 맞추는지 짧게. 모르면 null",
          "llm": false,
          "ui": true,
          "max": 40
        }
      },
      "checks": [],
      "rules": [],
      "llm": false,
      "runner": "rnd.note.sync",
      "uses": [
        {
          "module": "src/rndnote.js",
          "export": "syncInfo"
        },
        {
          "module": "src/rndnote.js",
          "export": "findPage"
        },
        {
          "module": "src/rndnote.js",
          "export": "readPage"
        },
        {
          "module": "src/rndnote.js",
          "export": "createPage"
        },
        {
          "module": "src/rndnote.js",
          "export": "writeBlock"
        },
        {
          "module": "src/rndnote.js",
          "export": "openNote"
        }
      ],
      "then": [],
      "next": "받아 고친 것이 있으면 장부를 저장하고, 페이지가 없으면 만들고 달라졌으면 쓴다. 손잡이(pageId·memo·del·at)를 rndNote 에 적는다. 도는 중에 다시 부르면 끝난 뒤 한 번 더 돈다"
    },
    "rnd.research.share": {
      "id": "rnd.research.share",
      "domain": "rnd",
      "kind": "research.share",
      "title": "연구내용 원노트 올리기",
      "status": "planned",
      "confirm": true,
      "effect": "write",
      "log": "rnd",
      "summary": "연구내용 원노트 올림 {projectId}",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — 차년도(오늘이 든 것)·변경이력 날짜·zip 이름"
        },
        "me": {
          "from": "me",
          "desc": "내 이름 — 연구내용 페이지의 올린 사람(by)"
        },
        "share": {
          "from": "storage:researchShare",
          "type": "object",
          "desc": "올린 페이지의 손잡이({ [과제명 키]: { pageId, webUrl, title, name, at } } — 있으면 그 페이지를 고친다)",
          "log": false
        }
      },
      "fields": {
        "projectId": {
          "type": "string",
          "required": true,
          "label": "과제 id",
          "desc": "올릴 과제의 id(장부의 과제 — 과제명·과제번호로 기록을 찾는다)",
          "read": "올릴 과제의 id",
          "llm": false,
          "ui": true,
          "max": 40
        },
        "auto": {
          "type": "boolean",
          "label": "저절로",
          "desc": "계획서를 다시 넣은 뒤 저절로 다시 올리는 것인가(링크를 복사하지 않는다)",
          "read": "사용자가 누른 것이 아니면 true",
          "llm": false,
          "ui": true
        }
      },
      "checks": [],
      "rules": [],
      "llm": false,
      "runner": "rnd.research.share",
      "uses": [
        {
          "module": "rndpanel.js",
          "export": "createRndPanel"
        },
        {
          "module": "rerp/plussync.js",
          "export": "createPlusSync"
        }
      ],
      "then": [],
      "next": "올린 페이지(pageId·webUrl·title)를 researchShare 에 적고, 누른 것이면 링크 글(RSY.linkText)을 복사한다"
    },
    "rnd.skills.zip": {
      "id": "rnd.skills.zip",
      "domain": "rnd",
      "kind": "skills.zip",
      "title": "스킬 묶음 저장",
      "status": "planned",
      "confirm": true,
      "effect": "draft",
      "log": "rnd",
      "summary": "스킬 묶음 저장 {name}",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — 차년도(오늘이 든 것)·변경이력 날짜·zip 이름"
        },
        "me": {
          "from": "me",
          "desc": "내 이름 — 연구내용 페이지의 올린 사람(by)"
        }
      },
      "fields": {
        "name": {
          "type": "string",
          "label": "zip 이름",
          "desc": "내려받는 파일 이름(비면 src/rndskills.js zipName(today) — rnd-skills_<오늘>.zip)",
          "read": "사용자가 파일 이름을 정했을 때만. 그 밖에는 null",
          "llm": true,
          "ui": true,
          "example": "rnd-skills_2026-10-16.zip",
          "max": 100
        }
      },
      "checks": [],
      "rules": [],
      "llm": false,
      "runner": "rnd.skills.zip",
      "uses": [
        {
          "module": "src/rndskills.js",
          "export": "checkManifest"
        },
        {
          "module": "src/rndskills.js",
          "export": "bundleSkills"
        },
        {
          "module": "src/rndskills.js",
          "export": "zipName"
        }
      ],
      "then": [],
      "next": "묶은 바이트를 내려받고(download) 상태 줄에 크기를 적는다. 목록(rnd/skills.json)을 못 읽으면 묶지 않는다"
    },
    "rnd.extract": {
      "id": "rnd.extract",
      "domain": "rnd",
      "kind": "extract",
      "title": "사업계획서에서 스냅샷 YAML 뽑기",
      "status": "planned",
      "confirm": true,
      "effect": "draft",
      "log": "rnd",
      "summary": "R&D 스냅샷 뽑기 {stage}차년도",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — 차년도(오늘이 든 것)·변경이력 날짜·zip 이름"
        },
        "me": {
          "from": "me",
          "desc": "내 이름 — 연구내용 페이지의 올린 사람(by)"
        }
      },
      "fields": {
        "yaml": {
          "type": "string",
          "required": true,
          "label": "스냅샷 YAML",
          "desc": "사업계획서에서 뽑은 당해 차년도 KR 스냅샷 YAML 전문(KR_<과제>.yaml 의 본문 — 코드 펜스 없음)",
          "read": "스냅샷 YAML 전문 — [스킬 규칙 2] structured_output.md 의 키 구조(meta · 연구개발내용 · 예산) 그대로, 한국선급(KR) 행·블록과 당해 차년도 행만. 코드 펜스(```)·설명·머리말 없이 YAML 글만 적습니다",
          "llm": true,
          "ui": true,
          "max": 120000
        },
        "alias": {
          "type": "string",
          "label": "별칭 제안",
          "desc": "과제 별칭 제안(칩·머리에 과제명 대신 보이는 약어 — 사람이 고친다. 이미 있는 과제면 장부의 별칭을 쓴다)",
          "read": "과제의 짧은 약어(영문 대문자 또는 한글 2~10자 — SSCB·PEMFC 꼴). 문서에 약어가 있으면 그것, 없으면 과제명에서 짓습니다",
          "llm": true,
          "ui": true,
          "example": "SSCB",
          "max": 60
        },
        "stage": {
          "type": "integer",
          "label": "뽑은 차년도",
          "desc": "뽑은 차년도 번호(meta.차년도 와 같은 수) — 코드가 meta.차년도·파일 머리 주석을 이 차년도로 맞춘다",
          "read": "뽑은 차년도의 번호(2차년도면 2) — meta.차년도 에 적은 것과 같은 수",
          "llm": true,
          "ui": true,
          "example": 2,
          "min": 1,
          "max": 20
        },
        "warnings": {
          "type": "string",
          "label": "경고",
          "desc": "못 찾은 블록·원문끼리 어긋난 값·추정한 것 — \" / \" 로 이은 한 글(미리보기에 보인다)",
          "read": "못 찾은 블록·원문끼리 어긋난 값·추정한 것을 \" / \" 로 이은 한 글. 없으면 null",
          "llm": true,
          "ui": true,
          "example": "8-3 (4) 간접비 세부 표를 찾지 못함 / 표지의 총연구개발비 합계가 연차별 합과 다름",
          "max": 3000
        },
        "file": {
          "type": "file",
          "label": "원본 문서",
          "desc": "넣은 사업계획서(이름·형식만 — 바이트·고른 쪽의 작은 PDF 는 실행 때 ctx 로)",
          "read": "이 칸은 사용자의 말로 채우지 않습니다 — 사용자가 끌어다 놓거나 고른 문서 그대로입니다",
          "llm": false,
          "ui": true
        },
        "stageWanted": {
          "type": "integer",
          "label": "고른 차년도",
          "desc": "화면에서 고른 차년도(비면 자동 — LLM 이 오늘이 든 차년도를 고른다. 빈 차년도 카드에서 열면 그 차년도. \"모든 차년도\" 면 차년도마다 한 번씩 물으며 그때마다 그 차년도)",
          "read": "사용자가 \"N차년도\" 를 집어 말했을 때만 그 번호. 아니면 null(오늘이 든 차년도)",
          "llm": false,
          "ui": true,
          "min": 1,
          "max": 20
        },
        "projectId": {
          "type": "string",
          "label": "과제 id",
          "desc": "대상 과제의 id(빈 차년도 카드에서 열었을 때 — ＋ 로 열면 비고, 뽑은 과제명·과제번호가 장부의 과제와 같으면 그 과제로 들어간다)",
          "read": "대상 과제의 id. 새 과제면 null",
          "llm": false,
          "ui": true,
          "max": 40
        }
      },
      "checks": [],
      "rules": [
        "출력 yaml 은 [스킬 규칙 2] structured_output.md 의 키 구조 그대로인 스냅샷 YAML 전문입니다 — 코드 펜스·설명 없이 YAML 글만 적습니다. meta.과제명 은 표지의 과제명을 글자 그대로 적습니다. 표지에서 과제명을 찾지 못하면 이 문서에서는 스냅샷을 뽑지 못한 것입니다 — yaml 에는 찾은 것만 적고 warnings 첫머리에 \"과제명을 찾지 못함\" 과 까닭을 적습니다.",
        "한국선급(KR) 행·블록만 넣습니다(타 기관 행·블록은 뺍니다 — meta.표지 의 과제 식별 필드만 예외). 당해 차년도 행만 넣습니다 — 연차는 키로 두되(연차: N차년도 · 목표치: {N차년도: …}) 값은 그 한 연차뿐입니다. [스킬 규칙 1] extract_fields.yaml 의 include 만 넣고 exclude 는 빼며, fields 가 false 인 블록은 키째 뺍니다.",
        "금액은 수로 적습니다(쉼표와 \"천원\" 을 뗌) — 단위는 예산.단위: 천원 입니다. 합계·소계·총액은 원문의 합계 행에 적힌 값만 옮깁니다(새로 더하지 않습니다). 모르는 값은 null 입니다. 당해 연차분이 원문에 없는 블록은 명시적 빈 블록(- 연차: N차년도 · 참여자: [] · 소계: null)으로 둡니다.",
        "차년도: 입력의 \"뽑을 차년도\" 에 N차년도가 적혀 있으면 그 차년도입니다. \"오늘이 든 차년도\" 라고 적혀 있으면 표지의 연차별 연구개발기간 표에서 오늘 날짜가 든 차년도를 고릅니다(표를 읽을 수 없으면 입력의 \"장부 기준 오늘이 든 차년도\" 를 씁니다). 문서가 기준으로 삼은 연차와 다르면 오늘 기준을 택하고 warnings 에 적습니다. 고른 차년도를 meta.차년도(N차년도)와 stage(수 N)에 같이 적습니다.",
        "meta 에는 과제명 · 수행기관(한국선급(KR)) · 단계 · 차년도 · 연차범위 · 연차별기간 · 기간 · 연구개발과제번호 · 협약일(YYYY-MM-DD, 있으면) · 표지 블록을 넣습니다. meta.rev · meta.source 와 파일 첫 줄의 머리 주석(# [N차년도 최초] …)은 코드가 적으니 넣지 않아도 됩니다(넣어도 됩니다).",
        "스킬 문서의 절차(RND_PROJECT 폴더 · _source 이동 · md 변환 · 에이전트 · /rnd-kr-history init · year_slice.py 실행 · JSON 사본)는 무시합니다 — 여기서는 YAML 글 하나만 냅니다. 파일을 만들거나 도구를 부르지 않습니다.",
        "첨부한 PDF 의 쪽은 입력 글의 \"— N쪽 —\" 표시와 같은 쪽입니다(표의 칸은 PDF 그림으로, 글자는 입력 글로 봅니다). 입력에 없는 쪽의 값을 지어내지 않습니다 — 찾지 못한 값은 null, 찾지 못한 블록은 빈 블록으로 두고 warnings 에 적습니다.",
        "alias 는 과제의 짧은 약어입니다(영문 대문자 또는 한글 2~10자 — SSCB · PEMFC 꼴). 문서에 약어가 있으면 그것을, 없으면 과제명에서 짓습니다.",
        "warnings 는 못 찾은 블록 · 원문끼리 어긋난 값 · 추정한 것을 \" / \" 로 잇습니다. 없으면 null 입니다."
      ],
      "llm": true,
      "task": "rnd.extract",
      "runner": "rnd.extract",
      "uses": [
        {
          "module": "rndgen/llm.js",
          "export": "askRndTask"
        },
        {
          "module": "src/rndyaml.js",
          "export": "kindOf"
        },
        {
          "module": "src/rndyaml.js",
          "export": "readSnapshot"
        },
        {
          "module": "rndgen/source.js",
          "export": "readDocument"
        },
        {
          "module": "rndgen/yaml.js",
          "export": "checkExtracted"
        },
        {
          "module": "rndgen/yaml.js",
          "export": "finalizeExtracted"
        },
        {
          "module": "rndgen/yaml.js",
          "export": "previewApply"
        }
      ],
      "then": [],
      "next": "미리보기(과제명·차년도·비목별 예산·참여연구자·경고)와 별칭 칸을 보인다 → 사람이 \"넣기\" 를 누르면 rnd.intake(장부 넣기 — rnd.yaml 과 같은 길)·rndYamlText 저장·setAlias 가 뒤따른다. \"YAML 파일로 저장\" 은 내려받기뿐이다"
    },
    "rnd.revise": {
      "id": "rnd.revise",
      "domain": "rnd",
      "kind": "revise",
      "title": "변경사항으로 YAML 고치기",
      "status": "planned",
      "confirm": true,
      "effect": "draft",
      "log": "rnd",
      "summary": "R&D YAML 고치기 {summary}",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — 차년도(오늘이 든 것)·변경이력 날짜·zip 이름"
        },
        "me": {
          "from": "me",
          "desc": "내 이름 — 연구내용 페이지의 올린 사람(by)"
        }
      },
      "fields": {
        "yaml": {
          "type": "string",
          "required": true,
          "label": "고친 YAML",
          "desc": "변경사항을 반영한 YAML 전문(기준 YAML 의 키 구조·주석·차례 그대로 — 코드 펜스 없음)",
          "read": "변경사항이 말한 곳만 고친 YAML 전문 — [기준 YAML] 의 키 구조·주석·차례를 그대로 두고, 코드 펜스(```)·설명 없이 YAML 글만 적습니다",
          "llm": true,
          "ui": true,
          "max": 120000
        },
        "summary": {
          "type": "string",
          "required": true,
          "label": "변경분 한 줄",
          "desc": "무엇을 바꿨는지 한 줄 — 파일 머리의 \"# 변경분:\" 에 그대로 들어간다",
          "read": "무엇을 바꿨는지 한국어 한 줄(경로 · 전 → 후, 여럿이면 \" · \" 로 잇습니다)",
          "llm": true,
          "ui": true,
          "example": "예산.비목별[2차년도].연구재료비 12,000 → 15,000 · 참여연구자 홍길동 추가",
          "max": 300
        },
        "changes": {
          "type": "list",
          "label": "바뀐 곳",
          "desc": "바꾼 곳마다 경로와 전·후 값(글) — 미리보기의 바뀐 곳 목록과 견준다",
          "read": "바꾼 곳마다 한 줄 — 경로와 바꾸기 전·후의 값(글로). 바꾼 곳이 없으면 빈 목록",
          "llm": true,
          "ui": true,
          "max": 50,
          "item": {
            "path": {
              "type": "string",
              "required": true,
              "desc": "바꾼 칸의 경로",
              "read": "바꾼 칸의 경로 — 목록은 [연차]·[성명] 처럼 그 줄의 열쇠로 적습니다(예: 예산.비목별[2차년도].직접비.연구재료비)",
              "max": 200
            },
            "before": {
              "type": "string",
              "desc": "바꾸기 전의 값(글)",
              "read": "바꾸기 전의 값(글로). 새로 넣은 칸이면 null",
              "max": 500
            },
            "after": {
              "type": "string",
              "desc": "바꾼 뒤의 값(글)",
              "read": "바꾼 뒤의 값(글로). 뺀 칸이면 null",
              "max": 500
            }
          }
        },
        "warnings": {
          "type": "string",
          "label": "경고",
          "desc": "모호해서 바꾸지 않은 것·기준 YAML 에 해당 칸이 없는 것 — \" / \" 로 이은 한 글(미리보기에 보인다)",
          "read": "모호해서 바꾸지 않은 것 · 기준 YAML 에 해당 칸이 없어 바꾸지 않은 것 · 다시 맞춘 합계를 \" / \" 로 이은 한 글. 없으면 null",
          "llm": true,
          "ui": true,
          "max": 3000
        },
        "projectId": {
          "type": "string",
          "label": "과제 id",
          "desc": "고치는 과제의 id(보고 있는 과제)",
          "read": "이 칸은 사용자의 말로 채우지 않습니다 — 보고 있는 과제입니다",
          "llm": false,
          "ui": true,
          "max": 40
        },
        "n": {
          "type": "integer",
          "label": "차년도",
          "desc": "고치는 차년도(보고 있는 차년도)",
          "read": "이 칸은 사용자의 말로 채우지 않습니다 — 보고 있는 차년도입니다",
          "llm": false,
          "ui": true,
          "min": 1,
          "max": 20
        },
        "text": {
          "type": "string",
          "label": "변경 글",
          "desc": "사람이 붙여 넣은 변경 내용(메일·공문·메모·표 — 2만 자에서 자른다)",
          "read": "사용자가 붙여 넣은 변경 내용 그대로",
          "llm": false,
          "ui": true,
          "max": 20000
        },
        "files": {
          "type": "list",
          "label": "붙인 문서",
          "desc": "변경 내용으로 붙인 문서(이름·형식만 — 글자는 rndgen/source.js 가 뽑아 입력 글에 싣는다)",
          "read": "이 칸은 사용자의 말로 채우지 않습니다 — 사용자가 붙인 문서 그대로입니다",
          "llm": false,
          "ui": true,
          "max": 6,
          "item": {
            "name": {
              "type": "string",
              "desc": "문서 이름",
              "read": "문서 이름",
              "max": 200
            },
            "type": {
              "type": "string",
              "desc": "문서 형식(MIME)",
              "read": "문서 형식",
              "max": 100
            }
          }
        }
      },
      "checks": [],
      "rules": [
        "[기준 YAML] 의 키 구조 · 주석 · 차례를 그대로 두고 [변경사항](과 붙인 문서 글자)이 말한 곳만 고친 YAML 전문을 yaml 에 냅니다 — 코드 펜스 · 설명 없이 YAML 글만 적습니다.",
        "금액은 수로 적습니다(쉼표 · 단위 글자를 뗌) — 단위는 기준 YAML 의 예산.단위 를 따릅니다(변경 글의 금액이 다른 단위 — 원 등 — 면 기준 단위로 바꿔 적습니다).",
        "합계 · 소계 · 총액은 변경사항이 말하지 않았어도 그 아래 값이 바뀌었으면 다시 더해 맞춥니다(기준 YAML 안의 값으로만 — 이것이 사업계획서 뽑기와 다른 점입니다). 다시 맞춘 합계도 changes 에 적습니다.",
        "meta.rev 와 파일 머리 주석(# [재생성 rN] … · # 변경분: …)은 코드가 적으니 바꾸지 않습니다.",
        "참여연구자가 바뀌면 예산.참여연구자인건비 의 참여자 줄과 소계, 비목별의 인건비를 함께 고칩니다.",
        "변경사항이 모호하거나 기준 YAML 에 해당 칸이 없으면 바꾸지 말고 warnings 에 적습니다. 변경사항에 없는 값을 지어내지 않습니다.",
        "summary 는 \"예산.비목별[2차년도].연구재료비 12,000 → 15,000 · 참여연구자 홍길동 추가\" 꼴의 한 줄입니다.",
        "changes 는 바꾼 곳마다 한 줄 — path(목록은 [연차] · [성명] 처럼 그 줄의 열쇠로) · before · after(글로) 입니다. 새로 넣은 칸의 before, 뺀 칸의 after 는 null 입니다."
      ],
      "llm": true,
      "task": "rnd.revise",
      "runner": "rnd.revise",
      "uses": [
        {
          "module": "rndgen/llm.js",
          "export": "askRndTask"
        },
        {
          "module": "src/rndyaml.js",
          "export": "kindOf"
        },
        {
          "module": "src/rndyaml.js",
          "export": "readSnapshot"
        },
        {
          "module": "rndgen/yaml.js",
          "export": "bookToSnapshot"
        },
        {
          "module": "rndgen/yaml.js",
          "export": "finalizeRevised"
        },
        {
          "module": "rndgen/yaml.js",
          "export": "diffYaml"
        },
        {
          "module": "rndgen/yaml.js",
          "export": "previewApply"
        }
      ],
      "then": [],
      "next": "미리보기(변경분 한 줄·다음 판·구조 차이·새로 생길 변경이력 줄·경고)를 보인다 → 사람이 \"반영\" 을 누르면 rnd.intake(장부 넣기)·rndYamlText 저장이 뒤따른다. \"YAML 파일로 저장\" 은 내려받기뿐이다"
    },
    "room.search": {
      "id": "room.search",
      "domain": "room",
      "kind": "search",
      "title": "회의실 빈 시간 찾기",
      "hint": "회의실",
      "status": "live",
      "confirm": false,
      "effect": "none",
      "log": "ask",
      "summary": "{summary}",
      "preset": {
        "me": {
          "from": "me",
          "desc": "내 이름(패널 설정의 myName — 내 예약 판정에 쓴다)"
        },
        "today": {
          "from": "today",
          "desc": "오늘(YYYY-MM-DD) — 날짜가 없으면 오늘 하루를 본다"
        }
      },
      "fields": {
        "dateFrom": {
          "type": "date",
          "required": true,
          "label": "조회 시작일",
          "desc": "조회 시작일",
          "read": "조회 시작일(YYYY-MM-DD). 날짜가 없으면 오늘",
          "llm": true,
          "ui": true,
          "example": "2026-10-20"
        },
        "dateTo": {
          "type": "date",
          "required": true,
          "label": "조회 종료일",
          "desc": "조회 종료일(포함)",
          "read": "조회 종료일(YYYY-MM-DD, 포함). 날짜가 하나면 시작일과 같은 날",
          "llm": true,
          "ui": true,
          "example": "2026-10-21"
        },
        "hourFrom": {
          "type": "integer",
          "required": true,
          "label": "조회 시작 시",
          "desc": "하루 중 조회 시작 시",
          "read": "하루 중 조회 시작 시(0~23). 시간대가 없으면 9",
          "llm": true,
          "ui": true,
          "example": 9,
          "min": 0,
          "max": 23
        },
        "hourTo": {
          "type": "integer",
          "required": true,
          "label": "조회 종료 시",
          "desc": "하루 중 조회 종료 시",
          "read": "하루 중 조회 종료 시(1~24). 시간대가 없으면 18",
          "llm": true,
          "ui": true,
          "example": 18,
          "min": 1,
          "max": 24
        },
        "minSeats": {
          "type": "integer",
          "label": "최소 좌석 수",
          "desc": "필요한 최소 좌석 수",
          "read": "\"10명\" 처럼 인원이 나오면 그 수. 없으면 null",
          "llm": true,
          "ui": true,
          "example": 10,
          "min": 1,
          "max": 999
        },
        "minHours": {
          "type": "number",
          "label": "최소 시간",
          "desc": "연속으로 필요한 최소 시간",
          "read": "\"2시간짜리\" 처럼 필요한 길이가 나오면 그 시간. 없으면 null",
          "llm": true,
          "ui": true,
          "example": 2,
          "min": 0.5,
          "max": 24
        },
        "region": {
          "type": "enum",
          "label": "지역",
          "desc": "지역",
          "read": "지역 — 부산 또는 서울만. 말하지 않았으면 null",
          "llm": true,
          "ui": true,
          "example": "부산",
          "values": [
            "부산",
            "서울"
          ]
        },
        "summary": {
          "type": "string",
          "required": true,
          "label": "요약",
          "desc": "해석한 조건을 한 줄로 요약(한국어)",
          "read": "사용자가 확인할 수 있게 해석 결과를 한 줄로(한국어)",
          "llm": true,
          "ui": true,
          "example": "10/20~21 부산 10명 이상 2시간",
          "max": 200
        }
      },
      "checks": [
        {
          "left": "dateFrom",
          "op": "<=",
          "right": "dateTo",
          "message": "종료일이 시작일보다 앞섭니다"
        },
        {
          "left": "hourFrom",
          "op": "<",
          "right": "hourTo",
          "message": "종료 시가 시작 시보다 늦어야 합니다"
        }
      ],
      "rules": [
        "날짜가 없으면 오늘 하루만 조회합니다(dateFrom = dateTo = 오늘).",
        "\"내일\", \"이번 주\", \"다음 주\" 같은 표현은 오늘을 기준으로 실제 날짜로 바꿉니다.",
        "연도가 없으면 오늘과 같은 해로 봅니다.",
        "시간대가 없으면 hourFrom 9, hourTo 18 로 둡니다.",
        "\"10명\" 처럼 인원이 나오면 minSeats 에 넣습니다.",
        "\"2시간짜리\" 처럼 필요한 길이가 나오면 minHours 에 넣습니다.",
        "지역은 부산 또는 서울만 가능합니다.",
        "summary 는 사용자가 확인할 수 있게 해석 결과를 한 줄로 적습니다."
      ],
      "llm": true,
      "task": "search.room",
      "runner": "booking.search",
      "uses": [
        {
          "module": "src/search.js",
          "export": "findSlots"
        }
      ],
      "then": [],
      "next": "후보를 화면에 보인다(renderFound) → 사용자가 누르면 그 탭·날짜·지역으로 옮겨 칸을 골라 두고(applyFound) 예약하기는 room.reserve 다"
    },
    "room.reserve": {
      "id": "room.reserve",
      "domain": "room",
      "kind": "reserve",
      "title": "회의실 예약",
      "status": "live",
      "confirm": true,
      "effect": "write",
      "log": "reserve",
      "summary": "{room} {date} {start}~{end} · {title}",
      "preset": {
        "me": {
          "from": "me",
          "desc": "내 이름(패널 설정의 myName — 내 예약 판정에 쓴다)"
        },
        "region": {
          "from": "storage:region",
          "desc": "보고 있던 지역(지역 버튼 — storage 의 region)"
        }
      },
      "fields": {
        "room": {
          "type": "string",
          "required": true,
          "label": "회의실",
          "desc": "회의실 이름(사이트 목록의 이름)",
          "read": "조회 결과에서 고른 회의실 이름 그대로. 지어내지 않습니다",
          "llm": true,
          "ui": true,
          "example": "대회의실",
          "max": 100
        },
        "roomValue": {
          "type": "string",
          "required": true,
          "desc": "사이트의 회의실 값(코드 — 폼의 선택 값)",
          "read": "조회 결과의 회의실 값(코드) 그대로",
          "llm": false,
          "ui": true,
          "example": "12",
          "max": 50
        },
        "region": {
          "type": "enum",
          "label": "지역",
          "desc": "지역(화면이 보고 있던 날의 지역 — day.region)",
          "read": "고른 회의실의 지역",
          "llm": true,
          "ui": true,
          "example": "부산",
          "values": [
            "부산",
            "서울"
          ]
        },
        "date": {
          "type": "date",
          "required": true,
          "label": "예약일",
          "desc": "예약일",
          "read": "예약일(YYYY-MM-DD)",
          "llm": true,
          "ui": true,
          "example": "2026-10-20"
        },
        "start": {
          "type": "time",
          "required": true,
          "label": "시작",
          "desc": "시작 시각(격자의 칸 — 정시·30분)",
          "read": "시작 시각 HH:MM",
          "llm": true,
          "ui": true,
          "example": "09:00"
        },
        "end": {
          "type": "time",
          "required": true,
          "label": "종료",
          "desc": "종료 시각",
          "read": "종료 시각 HH:MM",
          "llm": true,
          "ui": true,
          "example": "11:00"
        },
        "title": {
          "type": "string",
          "required": true,
          "label": "회의주제",
          "desc": "회의주제(사이트의 필수 칸 — RUNNERS.room.missing)",
          "read": "사용자가 적은 회의주제. 지어내지 않습니다",
          "llm": true,
          "ui": true,
          "example": "주간 회의",
          "max": 100
        }
      },
      "checks": [
        {
          "left": "start",
          "op": "<",
          "right": "end",
          "message": "종료 시각이 시작보다 늦어야 합니다"
        }
      ],
      "rules": [],
      "llm": false,
      "runner": "booking.reserve",
      "uses": [
        {
          "module": "src/runners.js",
          "export": "RUNNERS"
        }
      ],
      "then": [],
      "next": "실행기가 다시 조회해 확인된 것만 ok 다(ok && verified) — 그 뒤 '내가 넣음' 기록(rememberBooked)과 내 이름(rememberName)은 패널이 남긴다. 실패하면 diagnose 작업이 원인을 읽는다"
    },
    "room.cancel": {
      "id": "room.cancel",
      "domain": "room",
      "kind": "cancel",
      "title": "회의실 예약 취소",
      "status": "live",
      "confirm": true,
      "effect": "write",
      "log": "cancel",
      "summary": "{room} {date} {start}~{end}",
      "preset": {
        "me": {
          "from": "me",
          "desc": "내 이름(패널 설정의 myName — 내 예약 판정에 쓴다)"
        },
        "region": {
          "from": "storage:region",
          "desc": "보고 있던 지역"
        }
      },
      "fields": {
        "room": {
          "type": "string",
          "required": true,
          "label": "회의실",
          "desc": "회의실 이름",
          "read": "취소할 예약의 회의실 이름 그대로",
          "llm": true,
          "ui": true,
          "example": "대회의실",
          "max": 100
        },
        "date": {
          "type": "date",
          "required": true,
          "label": "예약일",
          "desc": "예약일",
          "read": "취소할 예약의 날짜(YYYY-MM-DD)",
          "llm": true,
          "ui": true,
          "example": "2026-10-20"
        },
        "start": {
          "type": "time",
          "required": true,
          "label": "시작",
          "desc": "시작 시각",
          "read": "취소할 예약의 시작 시각 HH:MM",
          "llm": true,
          "ui": true,
          "example": "09:00"
        },
        "end": {
          "type": "time",
          "required": true,
          "label": "종료",
          "desc": "종료 시각",
          "read": "취소할 예약의 종료 시각 HH:MM",
          "llm": true,
          "ui": true,
          "example": "11:00"
        },
        "title": {
          "type": "string",
          "label": "회의주제",
          "desc": "그 예약의 회의주제(기록용)",
          "read": "그 예약의 회의주제. 모르면 null",
          "llm": true,
          "ui": true,
          "example": "주간 회의",
          "max": 100
        },
        "region": {
          "type": "enum",
          "label": "지역",
          "desc": "그 예약의 지역",
          "read": "그 예약의 지역. 모르면 null",
          "llm": true,
          "ui": true,
          "example": "부산",
          "values": [
            "부산",
            "서울"
          ]
        }
      },
      "checks": [
        {
          "left": "start",
          "op": "<",
          "right": "end",
          "message": "종료 시각이 시작보다 늦어야 합니다"
        }
      ],
      "rules": [],
      "llm": false,
      "runner": "booking.cancel",
      "uses": [
        {
          "module": "src/runners.js",
          "export": "RUNNERS"
        }
      ],
      "then": [],
      "next": "지운 뒤 그 날을 다시 읽는다(패널 load). 내 예약 목록에서 지웠으면 justBooked 에서도 뺀다(패널)"
    },
    "room.modify": {
      "id": "room.modify",
      "domain": "room",
      "kind": "modify",
      "title": "회의실 예약 수정",
      "status": "live",
      "confirm": true,
      "effect": "write",
      "log": "modify",
      "preset": {
        "me": {
          "from": "me",
          "desc": "내 이름(패널 설정의 myName — 내 예약 판정에 쓴다)"
        },
        "region": {
          "from": "storage:region",
          "desc": "보고 있던 지역"
        }
      },
      "fields": {
        "back": {
          "type": "object",
          "required": true,
          "label": "원래 예약",
          "desc": "되돌릴 원래 예약(원래 회의실·날짜·시간·제목 — 취소 뒤 새 예약이 안 되면 이것으로 되살린다). 원래 회의실이 지금 목록에 없으면 수정을 시작하지 않는다(rowValueOf)",
          "read": "지금 잡혀 있는 예약 그대로(조회 결과에서). 지어내지 않습니다",
          "llm": false,
          "ui": true,
          "from": "room.reserve",
          "fields": {
            "room": {
              "type": "string",
              "required": true,
              "label": "회의실",
              "desc": "회의실 이름(사이트 목록의 이름)",
              "read": "조회 결과에서 고른 회의실 이름 그대로. 지어내지 않습니다",
              "example": "대회의실",
              "max": 100
            },
            "roomValue": {
              "type": "string",
              "required": true,
              "desc": "사이트의 회의실 값(코드 — 폼의 선택 값)",
              "read": "조회 결과의 회의실 값(코드) 그대로",
              "example": "12",
              "max": 50
            },
            "region": {
              "type": "enum",
              "label": "지역",
              "desc": "지역(화면이 보고 있던 날의 지역 — day.region)",
              "read": "고른 회의실의 지역",
              "example": "부산",
              "values": [
                "부산",
                "서울"
              ]
            },
            "date": {
              "type": "date",
              "required": true,
              "label": "예약일",
              "desc": "예약일",
              "read": "예약일(YYYY-MM-DD)",
              "example": "2026-10-20"
            },
            "start": {
              "type": "time",
              "required": true,
              "label": "시작",
              "desc": "시작 시각(격자의 칸 — 정시·30분)",
              "read": "시작 시각 HH:MM",
              "example": "09:00"
            },
            "end": {
              "type": "time",
              "required": true,
              "label": "종료",
              "desc": "종료 시각",
              "read": "종료 시각 HH:MM",
              "example": "11:00"
            },
            "title": {
              "type": "string",
              "required": true,
              "label": "회의주제",
              "desc": "회의주제(사이트의 필수 칸 — RUNNERS.room.missing)",
              "read": "사용자가 적은 회의주제. 지어내지 않습니다",
              "example": "주간 회의",
              "max": 100
            }
          }
        },
        "next": {
          "type": "object",
          "required": true,
          "label": "새 조건",
          "desc": "새 조건(격자에서 고른 칸·회의주제 — pickToPayload). 다른 회의실·다른 날이어도 된다",
          "read": "사용자가 바꾸라고 한 회의실·날짜·시간·제목",
          "llm": false,
          "ui": true,
          "from": "room.reserve",
          "fields": {
            "room": {
              "type": "string",
              "required": true,
              "label": "회의실",
              "desc": "회의실 이름(사이트 목록의 이름)",
              "read": "조회 결과에서 고른 회의실 이름 그대로. 지어내지 않습니다",
              "example": "대회의실",
              "max": 100
            },
            "roomValue": {
              "type": "string",
              "required": true,
              "desc": "사이트의 회의실 값(코드 — 폼의 선택 값)",
              "read": "조회 결과의 회의실 값(코드) 그대로",
              "example": "12",
              "max": 50
            },
            "region": {
              "type": "enum",
              "label": "지역",
              "desc": "지역(화면이 보고 있던 날의 지역 — day.region)",
              "read": "고른 회의실의 지역",
              "example": "부산",
              "values": [
                "부산",
                "서울"
              ]
            },
            "date": {
              "type": "date",
              "required": true,
              "label": "예약일",
              "desc": "예약일",
              "read": "예약일(YYYY-MM-DD)",
              "example": "2026-10-20"
            },
            "start": {
              "type": "time",
              "required": true,
              "label": "시작",
              "desc": "시작 시각(격자의 칸 — 정시·30분)",
              "read": "시작 시각 HH:MM",
              "example": "09:00"
            },
            "end": {
              "type": "time",
              "required": true,
              "label": "종료",
              "desc": "종료 시각",
              "read": "종료 시각 HH:MM",
              "example": "11:00"
            },
            "title": {
              "type": "string",
              "required": true,
              "label": "회의주제",
              "desc": "회의주제(사이트의 필수 칸 — RUNNERS.room.missing)",
              "read": "사용자가 적은 회의주제. 지어내지 않습니다",
              "example": "주간 회의",
              "max": 100
            }
          }
        }
      },
      "checks": [],
      "rules": [],
      "llm": false,
      "runner": "booking.modify",
      "uses": [
        {
          "module": "src/modify.js",
          "export": "modifyReservation"
        },
        {
          "module": "src/runners.js",
          "export": "RUNNERS"
        }
      ],
      "then": [],
      "next": "결과(ok·stage·restored·lost·uncertain)는 modifyReservation 의 것 그대로다 — describeModifyResult 가 상태줄 문장을 만들고, lost·uncertain 이면 사이트에서 확인 링크를 붙인다(패널)"
    },
    "trip.create": {
      "id": "trip.create",
      "domain": "trip",
      "kind": "create",
      "title": "여비계산서(사전정산) 작성",
      "status": "live",
      "confirm": true,
      "effect": "write",
      "log": "trip",
      "summary": "여비계산서(사전정산) {dateFrom}~{dateTo} {place} · {purpose}",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘 날짜(YYYY-MM-DD)"
        },
        "me": {
          "from": "me",
          "desc": "내 이름(패널 설정의 myName) — 여비계산서 화면이 아는 이름(종류 파일의 tripMe)이 비었을 때 대신 쓴다"
        },
        "hrMe": {
          "from": "ctx:hrMe",
          "type": "object",
          "desc": "HR 의 나(사번 emplNo·이름 name — attendpanel 의 st.me). 사번이 없으면 못 돈다(HR 에서 사번을 확인하지 못함)",
          "required": true
        },
        "workplace": {
          "from": "storage:attendWorkplace",
          "desc": "근무지(서울·부산 — 근태 탭에 한 번 적으면 남는다). 칸의 workplace 가 비면 어댑터가 이것을 폼의 workplace 로 넘긴다(attendpanel 과 같다)"
        }
      },
      "fields": {
        "dateFrom": {
          "type": "date",
          "required": true,
          "label": "출발일",
          "desc": "출발일(계산서의 출장 시작일 sDate)",
          "read": "출발일(YYYY-MM-DD). \"내일\"·\"다음 주 수요일\" 은 오늘을 기준으로 실제 날짜로",
          "llm": true,
          "ui": true,
          "example": "2026-10-20"
        },
        "start": {
          "type": "time",
          "required": true,
          "label": "출발",
          "desc": "출발 시각(정시 — 시만 쓴다, sHour. 첫날 조식을 셈할 때 본다)",
          "read": "출발 시각 HH:MM(정시). 말하지 않았으면 아침 7시(07:00 — 2026-10-02 사용자 지정)",
          "llm": true,
          "ui": true,
          "default": "07:00",
          "example": "07:00"
        },
        "dateTo": {
          "type": "date",
          "required": true,
          "label": "도착일",
          "desc": "도착일(eDate — 당일이면 출발일과 같은 날)",
          "read": "도착일(YYYY-MM-DD). 당일이면 출발일과 같은 날",
          "llm": true,
          "ui": true,
          "example": "2026-10-21"
        },
        "end": {
          "type": "time",
          "required": true,
          "label": "도착",
          "desc": "도착 시각(정시 — 시만 쓴다, eHour. 마지막 날 석식을 셈할 때 본다)",
          "read": "도착 시각 HH:MM(정시). 말하지 않았으면 저녁 8시(20:00)",
          "llm": true,
          "ui": true,
          "default": "20:00",
          "example": "20:00"
        },
        "days": {
          "type": "integer",
          "required": true,
          "label": "며칠간",
          "desc": "며칠간 — 1 이면 당일출장(주재국·일비 없음), 2 이상이면 일반출장(일비·식비 내역)",
          "read": "며칠간인지(당일 1, 1박 2일이면 2). \"3일간\" 처럼 기간으로 말했으면 그 날 수",
          "llm": true,
          "ui": true,
          "default": 1,
          "example": 2,
          "min": 1,
          "max": 31
        },
        "place": {
          "type": "string",
          "required": true,
          "label": "출장지",
          "desc": "출장지(도시·지역) — 내릴 KTX 역(stationOf)과 기억해 둔 길의 열쇠(routeKey)다",
          "read": "출장지 — 도시·지역(예: 대전). \"대전 한국기계연구원\" 이면 대전. 지어내지 않습니다",
          "llm": true,
          "ui": true,
          "example": "대전",
          "max": 200
        },
        "venue": {
          "type": "string",
          "label": "장소",
          "desc": "찾아갈 기관·건물 — 계산서의 출장지 칸에 \"출장지(장소)\" 로 붙는다(tripLocation — 2026-10-08 사용자 지정)",
          "read": "찾아갈 기관·건물(예: 한국기계연구원). 말하지 않았으면 null",
          "llm": true,
          "ui": true,
          "example": "한국기계연구원",
          "max": 200
        },
        "purpose": {
          "type": "string",
          "required": true,
          "label": "목적",
          "desc": "출장 목적(계산서의 목적 칸)",
          "read": "목적·사유. 지어내지 않습니다",
          "llm": true,
          "ui": true,
          "example": "MVDC 차단기 실증 시험 참관",
          "max": 200
        },
        "workplace": {
          "type": "string",
          "label": "근무지",
          "desc": "떠나는 근무지(서울·부산) — 탈 KTX 역을 여기서 찾는다. 역을 못 찾으면 교통편 내역을 비워 올리고 notes 에 적는다. 비면 사전설정의 근무지",
          "read": "근무지 — 서울 또는 부산. 말하지 않았으면 null(사전설정의 근무지를 쓴다)",
          "llm": false,
          "ui": true,
          "example": "부산",
          "max": 100
        },
        "transport": {
          "type": "tags",
          "label": "교통편",
          "desc": "교통편(여럿 — 기차만 골랐을 때만 KTX 줄이 들어간다. 함께 고르면 다녀온 뒤 출장 카드에서 가는 편·오는 편을 고른다. 기본은 기차 — references/travel-rules.yaml transport.default)",
          "read": "기차(train)·비행기(plane)·버스(bus) 가운데 말한 것. 말하지 않았으면 null(기본 기차)",
          "llm": false,
          "ui": true,
          "default": [
            "train"
          ],
          "values": [
            "train",
            "plane",
            "bus"
          ]
        },
        "trainGrade": {
          "type": "enum",
          "label": "좌석 등급",
          "desc": "기차 좌석 등급(standard 일반석·first 특실 — ktx-fares.yaml 의 등급, 기본 일반석. 기차 아이콘을 한 번 더 누르면 특실)",
          "read": "특실이라고 했을 때만 first. 그 밖에는 null(일반석)",
          "llm": false,
          "ui": true,
          "default": "standard",
          "values": [
            "standard",
            "first"
          ]
        }
      },
      "checks": [
        {
          "left": "dateFrom",
          "op": "<=",
          "right": "dateTo",
          "message": "도착일이 출발일보다 앞섭니다"
        }
      ],
      "rules": [],
      "llm": false,
      "runner": "trip.create",
      "uses": [
        {
          "module": "src/travel.js",
          "export": "settlePlan"
        },
        {
          "module": "src/trip.js",
          "export": "tripCreate"
        },
        {
          "module": "src/routes.js",
          "export": "recallRoute"
        }
      ],
      "then": [],
      "next": "올린 뒤 목록을 다시 읽어 새 계산서(row.seq)를 확인한 것만 ok 다(tripCreate — 던지지 않으면 ok, §14.3). 패널은 새로 만든 것이면 routeOfPlan 으로 이 출장지의 교통편을 기억하고(keepTripRoute) 목록을 다시 읽는다(loadTrips). 이미 있으면(existing) 그 번호를 상태 줄에 적는다"
    },
    "trip.presave": {
      "id": "trip.presave",
      "domain": "trip",
      "kind": "presave",
      "title": "사전정산 다시 저장",
      "status": "live",
      "confirm": true,
      "effect": "write",
      "log": "trip",
      "summary": "여비계산서 {seq} 사전정산 다시 저장",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘 날짜(YYYY-MM-DD)"
        },
        "me": {
          "from": "me",
          "desc": "내 이름(패널 설정의 myName) — 여비계산서 화면이 아는 이름(종류 파일의 tripMe)이 비었을 때 대신 쓴다"
        },
        "tripMe": {
          "from": "ctx:tripMe",
          "desc": "여비계산서 목록 화면이 아는 내 이름(tripList 의 me — attendpanel 의 st.trips.me). 출장자가 여럿인 계산서에서 내 줄을 고른다. 비면 갈래의 me"
        },
        "workplace": {
          "from": "storage:attendWorkplace",
          "desc": "근무지 — 편의 떠나는 역·닿는 역을 찾는다(prePlan 의 workplace)"
        }
      },
      "fields": {
        "seq": {
          "type": "string",
          "required": true,
          "label": "계산서 번호",
          "desc": "여비계산서 번호(목록 줄의 seq — 줄 자체는 ctx.row). 실행기는 ctx.row.seq 와 같은지 본다",
          "read": "다시 저장할 여비계산서 번호. 열린 출장 카드의 계산서 번호 그대로 — 지어내지 않습니다",
          "llm": true,
          "ui": true,
          "example": "145580",
          "max": 20
        },
        "trseq": {
          "type": "string",
          "label": "출장자 번호",
          "desc": "내 출장자 번호(목록 줄 travelers[].trseq — §14.2 의 대상 식별자). 사전정산 다시 저장에는 쓰지 않아 비어도 된다 — 있으면 어댑터가 ctx.row 의 내 줄과 같은지 본다",
          "read": "내 출장자 번호. 모르면 null",
          "llm": true,
          "ui": true,
          "example": "203311",
          "max": 20
        },
        "picks": {
          "type": "list",
          "label": "가는 편·오는 편",
          "desc": "카드에서 다시 고른 편(prePlan 의 picks). 줄이 없는 편은 손대지 않은 것 — 사전정산의 줄 그대로다. 비행기·버스를 고르면 사전정산에는 그 편의 줄을 넣지 않는다",
          "read": "사용자가 가는 편·오는 편의 교통편을 바꾸라고 했을 때만. 말하지 않은 편은 줄을 넣지 않습니다",
          "llm": false,
          "ui": true,
          "max": 2,
          "item": {
            "leg": {
              "type": "enum",
              "required": true,
              "desc": "어느 편(go 가는 편·back 오는 편)",
              "read": "가는 편이면 go, 오는 편이면 back",
              "values": [
                "go",
                "back"
              ]
            },
            "t": {
              "type": "enum",
              "desc": "교통편(기차·비행기·버스)",
              "read": "기차(train)·비행기(plane)·버스(bus). 말하지 않았으면 null",
              "values": [
                "train",
                "plane",
                "bus"
              ]
            },
            "g": {
              "type": "enum",
              "desc": "좌석 등급(기차·비행기 — 한 번 더 누르면 특실, 2026-10-04 사용자 지정)",
              "read": "특실·비즈니스라고 했을 때만 first, 아니면 null(일반석)",
              "values": [
                "standard",
                "first"
              ]
            }
          }
        },
        "edits": {
          "type": "list",
          "label": "일자·시각 고침",
          "desc": "편의 일자·출발 시·도착 시를 카드에서 고친 것(prePlan 의 edits — 달라진 칸만 그 줄에 적어 보낸다, 교통편이 그대로면 set 으로 칸만 고친다). 고치지 않은 칸은 null",
          "read": "사용자가 그 편의 날짜나 출발·도착 시각을 바꾸라고 했을 때만. 시는 0~23 의 정수",
          "llm": false,
          "ui": true,
          "max": 2,
          "item": {
            "leg": {
              "type": "enum",
              "required": true,
              "desc": "어느 편",
              "read": "가는 편이면 go, 오는 편이면 back",
              "values": [
                "go",
                "back"
              ]
            },
            "date": {
              "type": "date",
              "desc": "그 편의 일자(YYYY-MM-DD)",
              "read": "그 편이 떠나는 날. 말하지 않았으면 null",
              "example": "2026-10-21"
            },
            "shr": {
              "type": "integer",
              "desc": "출발 시(정시 — 0 은 적지 않은 것으로 계산서에 00:00)",
              "read": "출발 시(0~23). 말하지 않았으면 null",
              "example": 7,
              "min": 0,
              "max": 23
            },
            "ehr": {
              "type": "integer",
              "desc": "도착 시(정시)",
              "read": "도착 시(0~23). 말하지 않았으면 null",
              "example": 10,
              "min": 0,
              "max": 23
            }
          }
        },
        "meal": {
          "type": "integer",
          "label": "식수",
          "desc": "일비·식비 줄의 식수(stayPlan 의 want — 0 부터 일수 × 하루 세 끼까지, 넘으면 실행기가 stayPlan 으로 자른다). null 이면 사전정산의 값 그대로. 당일출장(주재국)에는 없다",
          "read": "사용자가 식비 끼니 수를 말했을 때만(예: \"식비 4끼로\"). 말하지 않았으면 null",
          "llm": true,
          "ui": true,
          "example": 4,
          "min": 0,
          "max": 93
        }
      },
      "checks": [],
      "rules": [],
      "llm": false,
      "runner": "trip.presave",
      "uses": [
        {
          "module": "src/travel.js",
          "export": "prePlan"
        },
        {
          "module": "src/travel.js",
          "export": "stayPlan"
        },
        {
          "module": "src/trip.js",
          "export": "tripPreSave"
        }
      ],
      "then": [],
      "next": "저장한 뒤 화면을 다시 읽어 교통편 줄(과 고친 식수)이 바뀌었는지로 성공을 판정하고 목록의 지금 단계를 그대로 돌려준다(tripPreSave). 패널은 다시 읽은 줄(detail.rows)로 가는 편·오는 편의 새 바탕을 잡고 routeOfRows 로 이 출장지의 교통편을 기억하며(keepTripRoute) 목록을 다시 읽는다(freshTrip). 단계가 '사전정산 작성' 으로 돌아갔으면 카드에 `사전정산 완료` 가 선다(trip.preconfirm)"
    },
    "trip.preconfirm": {
      "id": "trip.preconfirm",
      "domain": "trip",
      "kind": "preconfirm",
      "title": "사전정산 완료(확정)",
      "status": "live",
      "confirm": true,
      "effect": "write",
      "log": "trip",
      "summary": "여비계산서 {seq} 사전정산 완료(확정)",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘 날짜(YYYY-MM-DD)"
        },
        "me": {
          "from": "me",
          "desc": "내 이름(패널 설정의 myName) — 여비계산서 화면이 아는 이름(종류 파일의 tripMe)이 비었을 때 대신 쓴다"
        },
        "tripMe": {
          "from": "ctx:tripMe",
          "desc": "여비계산서 목록 화면이 아는 내 이름(st.trips.me) — 출장자가 여럿일 때 내 계산서 화면을 연다. 비면 갈래의 me"
        }
      },
      "fields": {
        "seq": {
          "type": "string",
          "required": true,
          "label": "계산서 번호",
          "desc": "확정할 여비계산서 번호(목록 줄의 seq — 줄은 ctx.row). 실행기는 ctx.row.seq 와 같은지 본다",
          "read": "확정할 여비계산서 번호 — 열린 출장 카드의 것 그대로. 지어내지 않습니다",
          "llm": true,
          "ui": true,
          "example": "145580",
          "max": 20
        },
        "trseq": {
          "type": "string",
          "label": "출장자 번호",
          "desc": "내 출장자 번호(목록 줄 travelers[].trseq — §14.2 의 대상 식별자). 사전정산을 확정하기 전에는 보통 비어 있다(확정한 뒤 생긴다) — 있으면 어댑터가 ctx.row 의 내 줄과 같은지 본다",
          "read": "내 출장자 번호. 모르면 null",
          "llm": true,
          "ui": true,
          "example": "203311",
          "max": 20
        },
        "docNo": {
          "type": "string",
          "label": "신청서 번호",
          "desc": "그 출장의 HR 신청서 번호(기록·홈 카드가 출장 줄을 찾는 열쇠). 없어도 돈다",
          "read": "그 출장의 HR 신청서 번호. 모르면 null",
          "llm": true,
          "ui": true,
          "example": "2026-001234",
          "max": 20
        }
      },
      "checks": [],
      "rules": [],
      "llm": false,
      "runner": "trip.preconfirm",
      "uses": [
        {
          "module": "src/trip.js",
          "export": "tripPreConfirm"
        }
      ],
      "then": [],
      "next": "보낸 뒤 목록을 다시 읽어 사전정산이 \"완료\" 가 됐는지로 판정한다(아니면 던진다). 결과의 row 는 다시 읽은 줄(출장자 번호 trseq 가 이때 생긴다) — 패널이 freshTrip 으로 카드의 단계를 맞춘다. 그 뒤 사후정산(trip.after)·송부(trip.send)가 열린다"
    },
    "trip.postconfirm": {
      "id": "trip.postconfirm",
      "domain": "trip",
      "kind": "postconfirm",
      "title": "사후정산 완료(확정)",
      "status": "live",
      "confirm": true,
      "effect": "write",
      "log": "trip",
      "summary": "여비계산서 {seq} 사후정산 완료(확정)",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘 날짜(YYYY-MM-DD)"
        },
        "me": {
          "from": "me",
          "desc": "내 이름(패널 설정의 myName) — 여비계산서 화면이 아는 이름(종류 파일의 tripMe)이 비었을 때 대신 쓴다"
        },
        "tripMe": {
          "from": "ctx:tripMe",
          "desc": "여비계산서 목록 화면이 아는 내 이름(st.trips.me) — 출장자가 여럿일 때 내 계산서 화면을 연다. 비면 갈래의 me"
        }
      },
      "fields": {
        "seq": {
          "type": "string",
          "required": true,
          "label": "계산서 번호",
          "desc": "확정할 여비계산서 번호(목록 줄의 seq — 줄은 ctx.row)",
          "read": "확정할 여비계산서 번호 — 열린 출장 카드의 것 그대로. 지어내지 않습니다",
          "llm": true,
          "ui": true,
          "example": "145580",
          "max": 20
        },
        "trseq": {
          "type": "string",
          "label": "출장자 번호",
          "desc": "내 출장자 번호(목록 줄 travelers[].trseq — §14.2 의 대상 식별자). 있으면 어댑터가 ctx.row 의 내 줄과 같은지 본다",
          "read": "내 출장자 번호. 모르면 null",
          "llm": true,
          "ui": true,
          "example": "203311",
          "max": 20
        },
        "docNo": {
          "type": "string",
          "label": "신청서 번호",
          "desc": "그 출장의 HR 신청서 번호(기록용). 없어도 돈다",
          "read": "그 출장의 HR 신청서 번호. 모르면 null",
          "llm": true,
          "ui": true,
          "example": "2026-001234",
          "max": 20
        }
      },
      "checks": [],
      "rules": [],
      "llm": false,
      "runner": "trip.postconfirm",
      "uses": [
        {
          "module": "src/trip.js",
          "export": "tripPostConfirm"
        }
      ],
      "then": [],
      "next": "보낸 뒤 목록을 다시 읽어 사후정산이 \"완료\" 가 됐는지로 판정한다(아니면 던진다). 패널은 다시 작성하던 카드(reopen)를 정산 내역(보기)으로 되돌리고 freshTrip 으로 단계를 맞춘다. 송부(trip.send)는 이 다음이다"
    },
    "trip.after": {
      "id": "trip.after",
      "domain": "trip",
      "kind": "after",
      "title": "사후정산 작성",
      "status": "live",
      "confirm": true,
      "effect": "write",
      "log": "trip",
      "summary": "여비계산서 {seq} 사후정산 작성",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘 날짜(YYYY-MM-DD)"
        },
        "me": {
          "from": "me",
          "desc": "내 이름(패널 설정의 myName) — 여비계산서 화면이 아는 이름(종류 파일의 tripMe)이 비었을 때 대신 쓴다"
        },
        "tripMe": {
          "from": "ctx:tripMe",
          "desc": "여비계산서 목록 화면이 아는 내 이름(st.trips.me) — 출장자 번호(trseq)를 고르고 내 계산서 화면을 연다(tripAfterSave·tripPreConfirm 의 name). 비면 갈래의 me"
        }
      },
      "fields": {
        "seq": {
          "type": "string",
          "required": true,
          "label": "계산서 번호",
          "desc": "여비계산서 번호(목록 줄의 seq — 줄은 ctx.row, 어댑터가 같은지 본다)",
          "read": "사후정산을 올릴 여비계산서 번호 — 열린 출장 카드의 것 그대로. 지어내지 않습니다",
          "llm": true,
          "ui": true,
          "example": "145580",
          "max": 20
        },
        "trseq": {
          "type": "string",
          "label": "출장자 번호",
          "desc": "그 계산서에서 내 출장자 번호(목록 줄 travelers[].trseq — attendpanel 의 trseqOf). 사전정산을 확정하기 전에는 비어 있을 수 있다 — 그러면 어댑터가 확정한 뒤 다시 읽은 줄에서 찾는다",
          "read": "내 출장자 번호. 모르면 null(어댑터가 찾는다)",
          "llm": true,
          "ui": true,
          "example": "203311",
          "max": 20
        },
        "records": {
          "type": "list",
          "label": "읽은 증빙",
          "desc": "증빙 한 장마다 한 줄 — receipt 명세를 지난 기록(숙박 영수증·예약서·항공권·그 밖의 영수증). 앞서 넣어 둔 항공권(a.tickets)과 물어 둔 숙박 증빙(a.ask.records)도 같이 담는다(같은 파일 이름이면 새것만). 비어 있으면 바꾼 가는 편·오는 편만 올린다",
          "read": "이 칸은 사용자의 말로 채우지 않습니다 — 증빙 파일을 읽은 기록(receipt)이 그대로 들어갑니다",
          "llm": false,
          "ui": true,
          "max": 40,
          "item": {
            "docType": {
              "type": "enum",
              "required": true,
              "desc": "문서 종류. lodging_receipt(숙박 결제 영수증·인보이스)·lodging_booking(숙박 예약 확인서)·flight_ticket(항공권·탑승권·e-티켓)·flight_receipt(항공권 결제 영수증)·train_ticket(기차표)·bus_ticket(버스표)·other_receipt(그 밖의 영수증)·unknown(모름)",
              "read": "문서 종류. lodging_receipt(숙박 결제 영수증·인보이스)·lodging_booking(숙박 예약 확인서)·flight_ticket(항공권·탑승권·e-티켓)·flight_receipt(항공권 결제 영수증)·train_ticket(기차표)·bus_ticket(버스표)·other_receipt(그 밖의 영수증)·unknown(모름)",
              "values": [
                "lodging_receipt",
                "lodging_booking",
                "flight_ticket",
                "flight_receipt",
                "train_ticket",
                "bus_ticket",
                "other_receipt",
                "unknown"
              ]
            },
            "vendor": {
              "type": "string",
              "desc": "업체명(실제로 묵은 숙박업소·가맹점 이름 또는 항공사)",
              "read": "업체명(실제로 묵은 숙박업소·가맹점 이름 또는 항공사)",
              "max": 100
            },
            "seller": {
              "type": "string",
              "desc": "구매처 — 돈을 받은 곳. 예약 대행사를 거쳐 샀으면 그 대행사(아고다·부킹닷컴·야놀자 등), 직접 결제했으면 그 업체",
              "read": "구매처 — 돈을 받은 곳. 예약 대행사를 거쳐 샀으면 그 대행사(아고다·부킹닷컴·야놀자 등), 직접 결제했으면 그 업체",
              "max": 100
            },
            "sellerBiz": {
              "type": "string",
              "desc": "구매처의 사업자명(문서에 적힌 상호·법인명 — \"Agoda Company Pte. Ltd.\", \"(주)야놀자\"). 적혀 있지 않으면 null",
              "read": "구매처의 사업자명(문서에 적힌 상호·법인명 — \"Agoda Company Pte. Ltd.\", \"(주)야놀자\"). 적혀 있지 않으면 null",
              "max": 100
            },
            "bizNo": {
              "type": "string",
              "desc": "구매처의 사업자등록번호(000-00-00000). 적혀 있지 않으면 null",
              "read": "구매처의 사업자등록번호(000-00-00000). 적혀 있지 않으면 null",
              "max": 20
            },
            "payDate": {
              "type": "date",
              "desc": "결제일(영수증의 승인·결제 날짜)",
              "read": "결제일(영수증의 승인·결제 날짜)"
            },
            "payPlace": {
              "type": "string",
              "desc": "결제한 곳 — 영수증에 적힌 가맹점 주소나 지역(시·군·구까지). 적혀 있지 않으면 null",
              "read": "결제한 곳 — 영수증에 적힌 가맹점 주소나 지역(시·군·구까지). 적혀 있지 않으면 null",
              "max": 100
            },
            "atDestination": {
              "type": "boolean",
              "desc": "그 밖의 영수증(other_receipt)이 입력의 출장지와 같은 지역(시·군·구)에서 결제된 것인가. 영수증의 주소·지점명으로 가리고, 알 수 없으면 null",
              "read": "그 밖의 영수증(other_receipt)이 입력의 출장지와 같은 지역(시·군·구)에서 결제된 것인가. 영수증의 주소·지점명으로 가리고, 알 수 없으면 null"
            },
            "checkIn": {
              "type": "date",
              "desc": "숙박 체크인 날짜",
              "read": "숙박 체크인 날짜"
            },
            "checkOut": {
              "type": "date",
              "desc": "숙박 체크아웃 날짜",
              "read": "숙박 체크아웃 날짜"
            },
            "nights": {
              "type": "integer",
              "desc": "숙박 일수(박)",
              "read": "숙박 일수(박)",
              "min": 1,
              "max": 60
            },
            "total": {
              "type": "number",
              "desc": "총 결제 금액(숫자만) — 문서에 적힌 화폐(currency)의 금액",
              "read": "총 결제 금액(숫자만) — 문서에 적힌 화폐(currency)의 금액",
              "min": 0
            },
            "totalKRW": {
              "type": "number",
              "desc": "외화 문서에 원화로 결제·청구된 금액이 같이 적혀 있을 때 그 원화 금액. 원화 문서이거나 적혀 있지 않으면 null",
              "read": "외화 문서에 원화로 결제·청구된 금액이 같이 적혀 있을 때 그 원화 금액. 원화 문서이거나 적혀 있지 않으면 null",
              "min": 0
            },
            "supply": {
              "type": "number",
              "desc": "공급가액(부가세를 뺀 금액) — 문서에 따로 적혀 있을 때만",
              "read": "공급가액(부가세를 뺀 금액) — 문서에 따로 적혀 있을 때만",
              "min": 0
            },
            "vat": {
              "type": "number",
              "desc": "부가세 — 문서에 따로 적혀 있을 때만",
              "read": "부가세 — 문서에 따로 적혀 있을 때만",
              "min": 0
            },
            "currency": {
              "type": "enum",
              "desc": "화폐(ISO 세 글자 코드)",
              "read": "화폐(ISO 세 글자 코드)",
              "values": [
                "KRW",
                "USD",
                "EUR",
                "JPY",
                "CNY",
                "TWD",
                "AED",
                "SGD",
                "MYR",
                "CAD",
                "AUD",
                "NZD",
                "VND",
                "JOD",
                "KWD",
                "BHD",
                "ZAR",
                "RUB",
                "INR",
                "PKR",
                "IDR",
                "TRY",
                "SAR",
                "QAR",
                "BRL",
                "THB",
                "BND",
                "ILS",
                "PLN",
                "SEK",
                "CZK",
                "DKK",
                "NOK",
                "BDT",
                "KZT",
                "MNT",
                "GBP",
                "EGP",
                "PHP",
                "MXN",
                "HUF",
                "CHF",
                "HKD"
              ]
            },
            "corporateCard": {
              "type": "boolean",
              "desc": "법인카드로 결제했다고 문서에 적혀 있는가",
              "read": "법인카드로 결제했다고 문서에 적혀 있는가"
            },
            "transport": {
              "type": "enum",
              "desc": "교통비 문서(표·교통비 영수증)의 교통수단. plane(비행기)·train(기차)·subway(지하철)·ship(선박)·bus(버스)·taxi(택시). 교통비 문서가 아니면 null",
              "read": "교통비 문서(표·교통비 영수증)의 교통수단. plane(비행기)·train(기차)·subway(지하철)·ship(선박)·bus(버스)·taxi(택시). 교통비 문서가 아니면 null",
              "values": [
                "plane",
                "train",
                "subway",
                "ship",
                "bus",
                "taxi"
              ]
            },
            "airline": {
              "type": "string",
              "desc": "항공사 이름(한국어로 — 대한항공·아시아나항공·에어프레미아·제주항공 등)",
              "read": "항공사 이름(한국어로 — 대한항공·아시아나항공·에어프레미아·제주항공 등)",
              "max": 50
            },
            "flightNo": {
              "type": "string",
              "desc": "편명(KE1234)",
              "read": "편명(KE1234)",
              "max": 20
            },
            "flightDate": {
              "type": "date",
              "desc": "탑승일(비행기·기차·버스·택시 등을 탄 날)",
              "read": "탑승일(비행기·기차·버스·택시 등을 탄 날)"
            },
            "depPlace": {
              "type": "string",
              "desc": "출발지(도시·공항·역)",
              "read": "출발지(도시·공항·역)",
              "max": 50
            },
            "arrPlace": {
              "type": "string",
              "desc": "도착지(도시·공항·역)",
              "read": "도착지(도시·공항·역)",
              "max": 50
            },
            "depTime": {
              "type": "time",
              "desc": "출발 시각",
              "read": "출발 시각"
            },
            "arrTime": {
              "type": "time",
              "desc": "도착 시각",
              "read": "도착 시각"
            },
            "seatClass": {
              "type": "string",
              "desc": "좌석 등급(일반석·비즈니스 등)",
              "read": "좌석 등급(일반석·비즈니스 등)",
              "max": 20
            },
            "retDate": {
              "type": "date",
              "desc": "왕복표의 돌아오는 편 탑승일. 편도면 null",
              "read": "왕복표의 돌아오는 편 탑승일. 편도면 null"
            },
            "retDepPlace": {
              "type": "string",
              "desc": "왕복표의 돌아오는 편 출발지. 편도면 null",
              "read": "왕복표의 돌아오는 편 출발지. 편도면 null",
              "max": 50
            },
            "retArrPlace": {
              "type": "string",
              "desc": "왕복표의 돌아오는 편 도착지. 편도면 null",
              "read": "왕복표의 돌아오는 편 도착지. 편도면 null",
              "max": 50
            },
            "retDepTime": {
              "type": "time",
              "desc": "왕복표의 돌아오는 편 출발 시각. 편도면 null",
              "read": "왕복표의 돌아오는 편 출발 시각. 편도면 null"
            },
            "retFlightNo": {
              "type": "string",
              "desc": "왕복표의 돌아오는 편 편명. 편도면 null",
              "read": "왕복표의 돌아오는 편 편명. 편도면 null",
              "max": 20
            },
            "mileage": {
              "type": "integer",
              "desc": "이 항공권으로 적립되는 마일리지(문서에 적혀 있을 때만)",
              "read": "이 항공권으로 적립되는 마일리지(문서에 적혀 있을 때만)",
              "min": 0,
              "max": 100000
            },
            "passenger": {
              "type": "string",
              "desc": "탑승자·투숙자 이름",
              "read": "탑승자·투숙자 이름",
              "max": 50
            },
            "extra": {
              "type": "string",
              "desc": "계산서에 넣지 않지만 알아 둘 추가 정보(조식 포함·예약번호·취소 규정·수하물 등). 없으면 null",
              "read": "계산서에 넣지 않지만 알아 둘 추가 정보(조식 포함·예약번호·취소 규정·수하물 등). 없으면 null",
              "max": 300
            },
            "summary": {
              "type": "string",
              "required": true,
              "desc": "문서를 한 줄로 요약(한국어)",
              "read": "문서를 한 줄로 요약(한국어)",
              "max": 200
            },
            "file": {
              "type": "file",
              "desc": "그 증빙 파일의 참조(이름·형식·크기 — 바이트는 ctx.files 에서 이름으로 찾아 숙박 줄의 첨부 lodge_file 로 올린다)",
              "read": "증빙 파일의 이름과 형식. 지어내지 않습니다"
            },
            "confirmed": {
              "type": "boolean",
              "desc": "출장 기간과 안 맞아 알림 표시로 두었던 것을 사람이 이 출장의 증빙이 맞다고 확정했는가(periodMiss 가 맞는 것으로 친다 — 2026-10-05 사용자 지정)",
              "read": "사람이 보관 중인 증빙에서 `확정` 을 눌렀을 때만 true. 그 밖에는 null",
              "llm": false
            }
          }
        },
        "picks": {
          "type": "object",
          "label": "가는 편·오는 편",
          "desc": "카드에서 고른 가는 편·오는 편(afterPlan 의 picks 를 편 것). 고르지 않은 편은 t 가 null(사전정산 그대로). 항공권을 넣었거나 편이 사전정산과 달라졌을 때만 교통비 내역에 들어간다",
          "read": "사용자가 가는 편·오는 편의 교통편을 말했을 때만. 말하지 않은 편은 null",
          "llm": false,
          "ui": true,
          "fields": {
            "goT": {
              "type": "enum",
              "desc": "가는 편의 교통편",
              "read": "가는 편 — 기차(train)·비행기(plane)·버스(bus). 말하지 않았으면 null",
              "values": [
                "train",
                "plane",
                "bus"
              ]
            },
            "goG": {
              "type": "enum",
              "desc": "가는 편의 좌석 등급(기차·비행기 — 특실·비즈니스면 first. 항공 마일리지 적립률에도 든다)",
              "read": "가는 편이 특실·비즈니스라고 했을 때만 first",
              "values": [
                "standard",
                "first"
              ]
            },
            "backT": {
              "type": "enum",
              "desc": "오는 편의 교통편",
              "read": "오는 편 — 기차(train)·비행기(plane)·버스(bus). 말하지 않았으면 null",
              "values": [
                "train",
                "plane",
                "bus"
              ]
            },
            "backG": {
              "type": "enum",
              "desc": "오는 편의 좌석 등급",
              "read": "오는 편이 특실·비즈니스라고 했을 때만 first",
              "values": [
                "standard",
                "first"
              ]
            }
          }
        },
        "workplace": {
          "type": "string",
          "label": "근무지",
          "desc": "근무지에 적어 둔 글(서울·부산 — storage attendWorkplace, 패널이 넣는다) — 가는 편의 떠나는 곳·오는 편의 닿는 곳(legPlan 의 workplace)",
          "read": "근무지 — 서울 또는 부산. 말하지 않았으면 null",
          "llm": false,
          "ui": true,
          "example": "부산",
          "max": 100
        },
        "lodge": {
          "type": "list",
          "label": "숙박 줄의 결정",
          "desc": "상한액을 넘거나 원화 금액을 모르는 숙박 줄마다 사람이 고른 것. 처음 올릴 때는 비어 있고, 어댑터가 ask 로 되물은 뒤 답을 담아 새 기록을 짓는다(answerAsk·홈 카드의 pickSettle)",
          "read": "사용자가 그 숙박을 상한액으로 할지 실제 금액으로 할지, 원화로 얼마를 냈는지 말했을 때만",
          "llm": false,
          "ui": true,
          "max": 10,
          "item": {
            "key": {
              "type": "string",
              "required": true,
              "desc": "어느 숙박 줄인가 — 그 줄의 증빙 파일 이름들(lodgeKey)",
              "read": "그 숙박 줄의 증빙 파일 이름(여럿이면 ' | ' 로 이어서)",
              "max": 400
            },
            "settle": {
              "type": "enum",
              "required": true,
              "desc": "상한액으로(cap) · 실제 금액으로(actual — 1.5배 이내면 부서장 승인, 비고에 사유) · 외화 문서의 원화 금액을 적음(krw — amount 가 실제 금액이 된다)",
              "read": "상한액으로 하겠다면 cap, 실제 금액으로 하겠다면 actual, 원화로 낸 금액을 말했으면 krw",
              "values": [
                "cap",
                "actual",
                "krw"
              ]
            },
            "amount": {
              "type": "number",
              "desc": "krw 일 때 실제로 낸 원화 금액(환율로 어림하지 않는다). cap·actual 이면 null",
              "read": "사용자가 말한 원화 결제 금액(숫자만). 말하지 않았으면 null",
              "example": 143000,
              "min": 1,
              "max": 100000000
            },
            "reason": {
              "type": "string",
              "desc": "실제 금액으로 정산할 때 비고에 적는 상한 초과 사유(비면 기본 문구 — travel-rules.yaml lodging.over_cap.reason)",
              "read": "사용자가 상한 초과 사유를 말했을 때 그 글. 말하지 않았으면 null",
              "max": 200
            }
          }
        },
        "exclude": {
          "type": "list",
          "label": "안 올릴 증빙",
          "desc": "이번에 사후정산에 넣지 않을 증빙의 파일 이름(records 에는 있어도 afterPlan 에 넘기지 않는다 — 보관함에는 그대로 남는다)",
          "read": "사용자가 어떤 증빙은 올리지 말라고 했을 때 그 파일 이름",
          "llm": false,
          "ui": true,
          "max": 40,
          "item": {
            "name": {
              "type": "string",
              "required": true,
              "desc": "증빙 파일 이름",
              "read": "올리지 않을 증빙의 파일 이름 그대로",
              "max": 200
            }
          }
        },
        "always": {
          "type": "boolean",
          "label": "그대로 저장",
          "desc": "새로 올릴 것이 없어도 입력 화면의 폼을 그대로 저장한다(화면의 `저장` 버튼과 같다 — 송부 칸의 `보내기` 가 확정하기 전에 단계를 \"사후정산 작성\" 으로 만든다, saveAfter). 거짓이면 올릴 것이 없을 때 보내지 않는다(sent false)",
          "read": "보내기 전에 저장만 하라는 뜻일 때 true. 그 밖에는 null",
          "llm": false,
          "ui": true
        },
        "keepTrans": {
          "type": "boolean",
          "label": "모르는 편이면 교통 줄 그대로",
          "desc": "값을 모르는 편(항공권이 없는 비행기 편 등)이 있으면 교통비 내역을 사후정산 화면에 있는 그대로 둔다 — 교통 줄을 하나도 넣지 않는다(saveAfter). 거짓이면 아는 편만 넣는다(runAfter — 화면에 있던 교통 줄은 지워지고 아는 편으로 바뀐다)",
          "read": "보내기 전에 저장만 할 때처럼 교통비 내역은 건드리지 말라는 뜻일 때 true. 그 밖에는 null",
          "llm": false,
          "ui": true
        },
        "preconfirm": {
          "type": "boolean",
          "label": "사전정산 먼저 확정",
          "desc": "사전정산이 아직 \"작성\" 이면 확정부터 하고 올린다(runAfter 의 ensurePre — 2026-10-03 사용자 지정). 거짓이면 그런 계산서에는 올리지 않고 던진다",
          "read": "사전정산 확정까지 같이 하라고 했을 때 true. 그 밖에는 null",
          "llm": false,
          "ui": true
        }
      },
      "checks": [],
      "rules": [],
      "llm": false,
      "runner": "trip.after",
      "uses": [
        {
          "module": "src/after.js",
          "export": "afterPlan"
        },
        {
          "module": "src/after.js",
          "export": "lodgeSettle"
        },
        {
          "module": "src/after.js",
          "export": "lodgeDecide"
        },
        {
          "module": "src/after.js",
          "export": "lodgeAsk"
        },
        {
          "module": "src/after.js",
          "export": "lodgeKnown"
        },
        {
          "module": "src/trip.js",
          "export": "tripLodgeMax"
        },
        {
          "module": "src/trip.js",
          "export": "tripAfterLodges"
        },
        {
          "module": "src/trip.js",
          "export": "tripPreConfirm"
        },
        {
          "module": "src/trip.js",
          "export": "tripAfterSave"
        }
      ],
      "then": [],
      "next": "올린 뒤 목록을 다시 읽어 그 출장자의 사후정산이 \"작성\" 이상이 됐는지로 판정한다(tripAfterSave — 던지지 않으면 ok, sent false 도 정상, §14.3). 결과의 lodgeRows·lodgeSeqs 로 패널이 \"이 패널이 올린 줄\" 을 적어 두고(rememberMine), 보관함에 담고(evidence.keep — 실행기 밖), 숙박비 내역을 다시 읽는다(lodgeBox.reload). 보내려면 trip.postconfirm → trip.send 가 뒤따른다(송부 칸의 보내기가 잇는다)"
    },
    "trip.delete": {
      "id": "trip.delete",
      "domain": "trip",
      "kind": "delete",
      "title": "여비계산서 삭제(출장 취소)",
      "status": "live",
      "confirm": true,
      "effect": "write",
      "log": "trip",
      "summary": "여비계산서 {seq} 삭제(출장 취소) · {docNo}",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘 날짜(YYYY-MM-DD)"
        },
        "me": {
          "from": "me",
          "desc": "내 이름(패널 설정의 myName) — 여비계산서 화면이 아는 이름(종류 파일의 tripMe)이 비었을 때 대신 쓴다"
        },
        "tripMe": {
          "from": "ctx:tripMe",
          "desc": "여비계산서 목록 화면이 아는 내 이름(st.trips.me) — 다른 출장자가 있는지 가리고 내 계산서 화면을 연다. 비면 갈래의 me"
        }
      },
      "fields": {
        "seq": {
          "type": "string",
          "required": true,
          "label": "계산서 번호",
          "desc": "지울 여비계산서 번호(목록 줄의 seq — 줄은 ctx.row. 패널은 tripDocFor(it, rows, me) 로 그 출장의 줄을 찾는다)",
          "read": "지울 여비계산서 번호 — 취소하는 출장의 것 그대로. 지어내지 않습니다",
          "llm": true,
          "ui": true,
          "example": "145580",
          "max": 20
        },
        "trseq": {
          "type": "string",
          "label": "출장자 번호",
          "desc": "내 출장자 번호(목록 줄 travelers[].trseq — §14.2 의 대상 식별자). 삭제 폼은 출장자를 가리지 않아 쓰지 않는다 — 있으면 어댑터가 ctx.row 의 내 줄과 같은지 본다",
          "read": "내 출장자 번호. 모르면 null",
          "llm": true,
          "ui": true,
          "example": "203311",
          "max": 20
        },
        "docNo": {
          "type": "string",
          "label": "신청서 번호",
          "desc": "취소하는 출장의 HR 신청서 번호(기록 — 어느 출장의 계산서를 지웠는지)",
          "read": "취소하는 출장의 HR 신청서 번호. 모르면 null",
          "llm": true,
          "ui": true,
          "example": "2026-001234",
          "max": 20
        }
      },
      "checks": [],
      "rules": [],
      "llm": false,
      "runner": "trip.delete",
      "uses": [
        {
          "module": "src/trip.js",
          "export": "tripDelete"
        },
        {
          "module": "src/travel.js",
          "export": "tripDocFor"
        }
      ],
      "then": [],
      "next": "보낸 뒤 목록을 다시 읽어 그 계산서가 사라졌는지로 판정한다(아니면 던진다). 패널은 목록을 다시 읽고(loadTrips) 상태 줄에 지웠다고 적는다"
    },
    "trip.send": {
      "id": "trip.send",
      "domain": "trip",
      "kind": "send",
      "title": "여비 증빙 송부",
      "status": "live",
      "confirm": true,
      "effect": "write",
      "log": "trip",
      "summary": "여비 증빙 송부 {seq} · {account} · {channel}",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘 날짜(YYYY-MM-DD)"
        },
        "me": {
          "from": "me",
          "desc": "내 이름(패널 설정의 myName) — 여비계산서 화면이 아는 이름(종류 파일의 tripMe)이 비었을 때 대신 쓴다"
        },
        "tripMe": {
          "from": "ctx:tripMe",
          "desc": "여비계산서 목록 화면이 아는 내 이름(st.trips.me) — 계산서 PDF 를 내 출장자 번호로 받고(tripCalPdf 의 name), 제목·본문의 출장자에 적는다. 비면 갈래의 me"
        }
      },
      "fields": {
        "seq": {
          "type": "string",
          "required": true,
          "label": "계산서 번호",
          "desc": "보내는 여비계산서 번호(목록 줄의 seq — 줄은 ctx.row, 어댑터가 같은지 본다. 출장 기간·출장지도 거기서 읽는다)",
          "read": "보낼 여비계산서 번호 — 열린 출장 카드의 것 그대로. 지어내지 않습니다",
          "llm": true,
          "ui": true,
          "example": "145580",
          "max": 20
        },
        "docNo": {
          "type": "string",
          "label": "신청서 번호",
          "desc": "그 출장의 HR 신청서 번호 — 보관함(증빙)과 보낸 기록(sendDone)의 열쇠",
          "read": "그 출장의 HR 신청서 번호. 모르면 null",
          "llm": true,
          "ui": true,
          "example": "2026-001234",
          "max": 20
        },
        "account": {
          "type": "string",
          "required": true,
          "label": "과제·계정",
          "desc": "어느 과제 또는 계정의 여비인지(직접 적거나 이전에 보낸 세트에서 고른 것) — 글의 제목과 \"과제·계정\" 줄에 들어간다",
          "read": "사용자가 말한 과제 이름이나 계정. 지어내지 않습니다",
          "llm": true,
          "ui": true,
          "example": "MVDC 차단기 과제",
          "max": 100
        },
        "to": {
          "type": "object",
          "required": true,
          "label": "받는 사람",
          "desc": "담당자(쪽지의 받는 사람 조회 memoSuggest 로 고른 사람 — id 가 사번·계정이고 Teams 는 id@회사 도메인으로 보낸다). 직급·부서는 화면에만 보이고 기록에는 담지 않는다",
          "read": "사용자가 말한 받는 사람. 이름·ID 로 찾은 사람 가운데 고른 것 그대로 — 지어내지 않습니다",
          "llm": true,
          "ui": true,
          "fields": {
            "id": {
              "type": "string",
              "required": true,
              "desc": "받는 사람의 ID(사번·계정 — 쪽지의 to, Teams 의 메일 앞부분)",
              "read": "받는 사람의 ID 그대로",
              "example": "hgd",
              "max": 40
            },
            "name": {
              "type": "string",
              "desc": "이름(보낸 기록의 to 에 적힌다)",
              "read": "받는 사람의 이름. 모르면 null",
              "example": "홍길동",
              "max": 40
            }
          }
        },
        "channel": {
          "type": "enum",
          "required": true,
          "label": "보내는 길",
          "desc": "Teams(MCP localhost:5003) 또는 쪽지(eclass) — 송부 칸의 `보내는 길` 칩으로 고른 것(2026-10-04 사용자 지정). 팝업에 적힌 길이고, 보내는 순간 Teams 로 갈 수 없으면 보내지 않는다",
          "read": "Teams 로 보내라고 했으면 teams, 쪽지로 보내라고 했으면 memo. 말하지 않았으면 null(Teams 가 닿으면 Teams, 아니면 쪽지)",
          "llm": true,
          "ui": true,
          "values": [
            "teams",
            "memo"
          ]
        },
        "reason": {
          "type": "string",
          "label": "출장 목적",
          "desc": "신청서의 목적(it.reason) — 글의 \"목적\" 줄. 비면 줄을 뺀다",
          "read": "그 출장의 목적. 모르면 null",
          "llm": true,
          "ui": true,
          "example": "MVDC 차단기 실증 시험 참관",
          "max": 200
        },
        "file": {
          "type": "string",
          "required": true,
          "label": "PDF 이름",
          "desc": "보낼 PDF 의 이름 — 패널이 src/send.js pdfName({ trip, me }) 로 짓는다(\"여비증빙_<계산서>_<이름>.pdf\"). 계산서 출력은 calName 으로 그 안에 맨 앞에 선다",
          "read": "보낼 PDF 파일 이름. 사용자가 정해 말하지 않았으면 \"여비증빙_<계산서 번호>_<이름>.pdf\"",
          "llm": true,
          "ui": true,
          "example": "여비증빙_145580_김거화.pdf",
          "max": 100
        }
      },
      "checks": [],
      "rules": [],
      "llm": false,
      "runner": "trip.send",
      "uses": [
        {
          "module": "src/send.js",
          "export": "sendGate"
        },
        {
          "module": "src/send.js",
          "export": "sendable"
        },
        {
          "module": "src/send.js",
          "export": "sendTitle"
        },
        {
          "module": "src/send.js",
          "export": "sendLines"
        },
        {
          "module": "src/send.js",
          "export": "pdfName"
        },
        {
          "module": "src/send.js",
          "export": "calName"
        },
        {
          "module": "src/trip.js",
          "export": "tripCalPdf"
        },
        {
          "module": "src/pdf.js",
          "export": "buildPdf"
        },
        {
          "module": "src/teams.js",
          "export": "teamsSendFile"
        },
        {
          "module": "src/memo.js",
          "export": "memoSend"
        },
        {
          "module": "src/memo.js",
          "export": "memoHtml"
        }
      ],
      "then": [],
      "next": "보낸 뒤 패널이 과제·계정 + 받는 사람 + 길을 한 세트로 최근 목록 맨 앞에 기억하고(sendSets, 셋까지) 그 출장의 보낸 기록(sendDone)을 적는다 — 실행기 밖의 일이다. 계산서를 PDF 로 받지 못하면 보내지 않는다"
    },
    "trip.lodge": {
      "id": "trip.lodge",
      "domain": "trip",
      "kind": "lodge",
      "title": "사후정산 숙박 줄 손질",
      "status": "live",
      "confirm": true,
      "effect": "write",
      "log": "trip",
      "summary": "여비계산서 {seq} 숙박 줄 {lodgeSeq} · {action}",
      "preset": {
        "today": {
          "from": "today",
          "desc": "오늘 날짜(YYYY-MM-DD)"
        },
        "me": {
          "from": "me",
          "desc": "내 이름(패널 설정의 myName) — 여비계산서 화면이 아는 이름(종류 파일의 tripMe)이 비었을 때 대신 쓴다"
        },
        "tripMe": {
          "from": "ctx:tripMe",
          "desc": "여비계산서 목록 화면이 아는 내 이름 — 패널이 이 이름으로 출장자 번호(trseq)를 고른다(어댑터는 쓰지 않는다)"
        }
      },
      "fields": {
        "seq": {
          "type": "string",
          "required": true,
          "label": "계산서 번호",
          "desc": "여비계산서 번호",
          "read": "열린 출장 카드의 여비계산서 번호 그대로",
          "llm": true,
          "ui": true,
          "example": "145580",
          "max": 20
        },
        "trseq": {
          "type": "string",
          "required": true,
          "label": "출장자 번호",
          "desc": "내 출장자 번호(목록 줄 travelers[].trseq — attendpanel.js 의 trseqOf). 사후정산 입력 화면 주소에 든다 — 숙박비 내역은 이 번호가 있어야 서므로 누를 때는 늘 있다",
          "read": "내 출장자 번호. 모르면 null",
          "llm": true,
          "ui": true,
          "example": "203311",
          "max": 20
        },
        "lodgeSeq": {
          "type": "string",
          "required": true,
          "label": "숙박 줄 번호",
          "desc": "바꿀 줄의 번호(lodge_seq — 화면의 줄). 어댑터가 ctx.lodge 의 줄 번호와 같은지 본다",
          "read": "바꿀 숙박 줄의 번호 — 숙박비 내역의 줄 그대로",
          "llm": true,
          "ui": true,
          "example": "7",
          "max": 20
        },
        "action": {
          "type": "enum",
          "required": true,
          "label": "무엇을",
          "desc": "cap 상한액으로 낮춤(정산금액·공급가액·부가세를 바꾸고 비고의 사유를 걷음) · real 실제 금액으로 되돌림(비고에 사유를 이음) · reason 비고의 사유만 고침 · delete 줄 지움",
          "read": "상한액으로 하라면 cap, 실제 금액으로 하라면 real, 사유만 고치라면 reason, 지우라면 delete",
          "llm": true,
          "ui": true,
          "values": [
            "cap",
            "real",
            "reason",
            "delete"
          ]
        },
        "reason": {
          "type": "string",
          "label": "상한 초과 사유",
          "desc": "비고에 적을 사유 — reason 은 비면 기본 문구(LODGE_OVER_REASON), real 은 비면 비고에 이미 있는 사유 → 적어 둔 사유(attendLodgeActual) → 기본 문구 차례다. cap·delete 에는 쓰지 않는다. 화면의 `상한` 버튼은 null 로, `비고에 저장` 은 칸에 적힌 사유(비면 기본 문구)로 짓는다. 정산금액이 상한액을 넘는 줄은 사유가 필수다",
          "read": "사용자가 말한 상한 초과 사유. 말하지 않았으면 null(기본 문구)",
          "llm": true,
          "ui": true,
          "example": "인근 숙소비 상승으로 인해 숙박비 내에 숙박이 어려움",
          "max": 200
        }
      },
      "checks": [],
      "rules": [],
      "llm": false,
      "runner": "trip.lodge",
      "uses": [
        {
          "module": "src/trip.js",
          "export": "tripAfterLodgeAmount"
        },
        {
          "module": "src/trip.js",
          "export": "tripAfterLodgeComment"
        },
        {
          "module": "src/trip.js",
          "export": "tripAfterLodgeDelete"
        },
        {
          "module": "src/after.js",
          "export": "lodgeSettle"
        },
        {
          "module": "lodgebox.js",
          "export": "lodgeCapState"
        },
        {
          "module": "lodgebox.js",
          "export": "lodgeReasonOf"
        }
      ],
      "then": [],
      "next": "보낸 뒤 화면을 다시 읽어 그 줄의 정산금액·비고가 바뀌었는지(또는 줄이 없어졌는지)로 판정한다. 패널은 실제 금액·사유를 적어 두고(attendLodgeActual) 올린 내용의 칸을 맞춘다(patchLodgeInfo)"
    }
  },
  "tasks": {
    "attend": {
      "title": "근태 신청 폼 조각",
      "kinds": [
        "attend"
      ],
      "partial": true,
      "consumer": {
        "module": "src/attend.js",
        "export": "applyPatch"
      },
      "next": "사용자가 폼을 확인하고 누른다 → attend.<종류> 기록(op=save|request) → src/attend.js buildJob → src/hr.js hrRunJob",
      "role": "당신은 사내 근태 신청 도우미입니다. 사용자의 말에서 근태 신청 폼에 넣을 값을 뽑습니다. 입력에는 오늘 날짜와 달력, 지금 폼(JSON), 앞선 대화, 새 요청이 들어 있습니다.",
      "fields": {
        "kind": {
          "type": "enum",
          "label": "근태 종류",
          "desc": "근태 종류. trip(출장)·out(외근·교육·부서소통회)·flex(유연근무)·leaveout(외출)·leave(휴가)·health(건강검진)",
          "values": [
            "trip",
            "out",
            "flex",
            "leaveout",
            "leave",
            "health"
          ]
        },
        "dateFrom": {
          "type": "date",
          "label": "출발일·날짜·시작일",
          "desc": "종류별 — trip: 출발일(YYYY-MM-DD). \"내일\"·\"다음 주 수요일\" 은 오늘을 기준으로 실제 날짜로 (예: 2026-10-20); out·leaveout·health: 날짜(YYYY-MM-DD). \"내일\"·\"다음 주 수요일\" 은 오늘을 기준으로 실제 날짜로 (예: 2026-10-20); flex: 당일 유연근무의 날짜(YYYY-MM-DD). \"내일\"·\"다음 주 수요일\" 은 오늘을 기준으로 실제 날짜로 (예: 2026-10-20); leave: 시작일(YYYY-MM-DD). \"내일\"·\"다음 주 수요일\" 은 오늘을 기준으로 실제 날짜로 (예: 2026-10-20)"
        },
        "start": {
          "type": "time",
          "label": "출발·시작",
          "desc": "종류별 — trip: 출발 시각 HH:MM(정시 단위). 말하지 않았으면 null — 폼의 기본값 07:00 이 그대로다 (예: 07:00); out: 시작 시각 HH:MM(외근·소통은 30분 단위, 교육은 정시). 말하지 않았으면 null (예: 14:00); leaveout: 시작 시각 HH:MM(30분 단위). 말하지 않았으면 null (예: 14:00); health: 시작 시각 HH:MM(30분 단위). 하루 전체면 null (예: 09:00)"
        },
        "dateTo": {
          "type": "date",
          "label": "도착일·종료일",
          "desc": "종류별 — trip: 여러 날 출장의 종료일(YYYY-MM-DD). 당일이면 null (예: 2026-10-21); leave: 여러 날 휴가의 종료일(YYYY-MM-DD). 하루면 null (예: 2026-10-21)"
        },
        "end": {
          "type": "time",
          "label": "도착·종료",
          "desc": "종류별 — trip: 도착 시각 HH:MM(정시 단위). 말하지 않았으면 null — 폼의 기본값 20:00 (예: 20:00); out·leaveout: 종료 시각 HH:MM. \"2시부터 3시간\" 처럼 길이로 말했으면 셈해서 (예: 16:00); health: 종료 시각 HH:MM. \"2시부터 3시간\" 처럼 길이로 말했으면 셈해서 (예: 12:00)"
        },
        "days": {
          "type": "integer",
          "label": "며칠간",
          "desc": "종류별 — trip: 며칠간인지(당일 1, 1박 2일이면 2). \"3일간\" 처럼 기간으로 말했을 때 (예: 2); leave: 며칠간인지(하루 1, 이틀이면 2). \"3일간\" 처럼 기간으로 말했을 때 (예: 2)",
          "min": 1,
          "max": 31
        },
        "place": {
          "type": "string",
          "label": "출장지·장소",
          "desc": "종류별 — trip: 출장지 — 도시·지역(예: 대전). \"대전 한국기계연구원\" 이면 대전 (예: 대전); out: 장소(기관·건물·지역). 폼이 목적 뒤에 붙입니다 (예: 부산시청)",
          "max": 200
        },
        "venue": {
          "type": "string",
          "label": "장소",
          "desc": "장소 — 찾아갈 기관·건물(예: 한국기계연구원). 장소만 말했으면(\"KAIST\") 그 장소가 있는 도시를 place 에, 장소를 venue 에 (예: 한국기계연구원)",
          "max": 200
        },
        "purpose": {
          "type": "string",
          "label": "목적·사유",
          "desc": "종류별 — trip: 목적·사유. 사용자가 말한 것만 — 지어내지 않습니다 (예: 착수회의 참석); out: 목적·사유. 사용자가 말한 것만 — 지어내지 않습니다 (예: 과제 협의 (부산시청)); flex: 당일 유연근무의 사유. 사용자가 말한 것만 (예: 병원 방문); leaveout: 사유. 사용자가 말한 것만 — 지어내지 않습니다 (예: 병원 방문); health: 사유. 사용자가 말한 것만 — 지어내지 않습니다 (예: 건강검진)",
          "max": 200
        },
        "sub": {
          "type": "enum",
          "label": "종류",
          "desc": "종류별 — out: out 이면 OD(외근)·TR(교육)·MEET(부서소통회) (예: OD); leave: leave 이면 LY(연차·반차)·LH(체력단련) (예: LY)",
          "values": [
            "OD",
            "TR",
            "MEET",
            "LY",
            "LH"
          ]
        },
        "flexMode": {
          "type": "enum",
          "label": "기간",
          "desc": "유연근무를 넣는 길. day(당일)·week(주간·요일별)·all(전체·매일·월~금 모두) (예: day)",
          "values": [
            "day",
            "week",
            "all"
          ]
        },
        "flexStart": {
          "type": "enum",
          "label": "출근시간",
          "desc": "유연근무의 새 출근시간(당일·전체일 때) (예: 08:00)",
          "values": [
            "07:00",
            "08:00",
            "08:30",
            "09:00",
            "09:30",
            "10:00",
            "11:00"
          ]
        },
        "flexMon": {
          "type": "enum",
          "label": "월",
          "desc": "주간 유연근무의 월요일 출근시간",
          "values": [
            "07:00",
            "08:00",
            "08:30",
            "09:00",
            "09:30",
            "10:00",
            "11:00"
          ]
        },
        "flexTue": {
          "type": "enum",
          "label": "화",
          "desc": "주간 유연근무의 화요일 출근시간",
          "values": [
            "08:00",
            "08:30",
            "09:00",
            "09:30",
            "10:00"
          ]
        },
        "flexWed": {
          "type": "enum",
          "label": "수",
          "desc": "주간 유연근무의 수요일 출근시간",
          "values": [
            "08:00",
            "08:30",
            "09:00",
            "09:30",
            "10:00"
          ]
        },
        "flexThu": {
          "type": "enum",
          "label": "목",
          "desc": "주간 유연근무의 목요일 출근시간",
          "values": [
            "08:00",
            "08:30",
            "09:00",
            "09:30",
            "10:00"
          ]
        },
        "flexFri": {
          "type": "enum",
          "label": "금",
          "desc": "주간 유연근무의 금요일 출근시간",
          "values": [
            "07:00",
            "08:00",
            "08:30",
            "09:00",
            "09:30",
            "10:00",
            "11:00"
          ]
        },
        "half": {
          "type": "enum",
          "label": "구분",
          "desc": "하루짜리 연차의 구분. am(오전 반차)·pm(오후 반차)·full(전일). 휴가가 아니면 null (예: am)",
          "values": [
            "am",
            "pm",
            "full"
          ]
        },
        "wfa": {
          "type": "boolean",
          "label": "기념일 지원",
          "desc": "연차를 가족 기념일(생일·결혼기념일·어린이날 …)에 쓰는가 — \"기념일\"·\"기념일 지원\" 이라고 말했을 때만 true. 그 밖에는 null"
        },
        "allDay": {
          "type": "boolean",
          "label": "하루 전체",
          "desc": "건강검진을 하루 전체로 올리는가. 건강검진이 아니면 null (예: true)"
        },
        "reply": {
          "type": "string",
          "label": "답 한 줄",
          "desc": "무엇을 채웠는지 한국어 한 문장",
          "max": 300
        }
      },
      "checks": [
        {
          "left": "dateFrom",
          "op": "<=",
          "right": "dateTo",
          "drop": "dateTo",
          "message": "종료일이 시작일보다 앞서 종료일은 뺐습니다"
        }
      ],
      "rules": [
        "**이번 말에서 사용자가 말한 것만** 채웁니다. 말하지 않은 칸은 null 입니다. 장소와 목적을 지어내지 않습니다.",
        "지금 폼에 이미 들어 있는 값을 되풀이하지 않습니다. 바꾸라고 한 것만 넣습니다.",
        "\"내일\", \"다음 주 수요일\" 같은 표현은 오늘을 기준으로 실제 날짜로 바꿉니다. 연도가 없으면 오늘과 같은 해입니다.",
        "요일은 셈하지 말고 입력의 달력 줄에서 찾습니다.",
        "시각은 24시간제 HH:MM 입니다. 외근·외출·건강검진은 30분 단위, 출장·교육은 정시 단위입니다.",
        "\"2시부터 3시간\" 처럼 길이로 말했으면 end 에 끝나는 시각을 셈해 넣습니다.",
        "dateTo 는 여러 날 출장·휴가일 때만 넣습니다. \"1박 2일\"·\"3일간\" 처럼 기간으로 말했으면 days 에 날 수를 넣습니다(당일은 1).",
        "출장이 아니면 venue 는 null 이고 장소는 place 에 넣습니다.",
        "allDay 는 건강검진일 때만 true/false 이고, 그 외에는 null 입니다.",
        "reply 에는 **무엇을 채웠는지만** 한 문장으로 적습니다(\"…채웠습니다\"). 아직 아무것도 올라가지 않았으므로 등록·신청했다고 말하지 않고, 비어 있는 칸은 적지 않습니다(화면이 따로 보여 줍니다).",
        "종류가 trip(출장)일 때: 출장(trip)은 출장지(place — 도시·지역)와 장소(venue — 찾아갈 기관·건물)를 나눠 넣습니다. \"대전 한국기계연구원\" 이면 place 는 대전, venue 는 한국기계연구원입니다. 장소만 말했으면(\"KAIST\") 그 장소가 있는 도시를 place 에, 장소를 venue 에 넣습니다.",
        "종류가 out(외근·교육·부서소통회)일 때: 교육은 kind 가 out 이고 sub 가 TR 입니다. 외근이라고 말했으면 sub 는 OD 입니다.",
        "종류가 out(외근·교육·부서소통회)일 때: 부서소통회(소통회)는 kind 가 out 이고 sub 가 MEET 입니다. 시각(13:00~14:00)과 목적(\"부서소통회\")은 폼이 채우므로, 사용자가 다르게 말했을 때만 start·end·purpose 를 넣습니다.",
        "종류가 flex(유연근무)일 때: flex 는 유연근무(출근시간 변경. 자율출퇴근·시차출근이라고도 말합니다)입니다. 넣는 길(flexMode)은 셋입니다 — day(당일: 그 날 하루), week(주간: 월~금 요일마다), all(전체: 월~금 모두 같은 시간).",
        "종류가 flex(유연근무)일 때: flexMode 가 week 이면 말한 요일의 출근시간만 flexMon~flexFri 에 넣고 flexStart 는 null 입니다. day·all 이면 flexStart 를 쓰고 flexMon~flexFri 는 null 입니다.",
        "종류가 flex(유연근무)일 때: 07:00·11:00 출근은 월요일·금요일에만 있습니다.",
        "종류가 leave(휴가)일 때: 휴가(leave)의 sub 는 LY(연차·반차) 또는 LH(체력단련·체력관리)이고, 그냥 \"휴가\"라고만 했으면 sub 는 null 입니다.",
        "종류가 leave(휴가)일 때: \"오전 반차\"·\"오후 반차\"는 half 에 am·pm 을, 하루 종일이라고 했으면 full 을 넣습니다. 휴가에는 장소·목적이 없습니다.",
        "종류가 leave(휴가)일 때: \"가족 기념일\"·\"기념일 지원\"·\"결혼기념일에 연차\" 처럼 기념일을 말했으면 kind 는 leave, sub 는 LY, wfa 는 true 입니다. 기념일의 내용(대상자·신청사항·금액)은 폼의 칸에서 적으므로 넣지 않습니다.",
        "종류가 health(건강검진)일 때: 하루 전체라고 했으면 allDay 는 true, 시각을 말했으면 false 입니다."
      ]
    },
    "search.car": {
      "title": "차량 조회 조건",
      "kinds": [
        "car"
      ],
      "consumer": {
        "module": "src/search.js",
        "export": "findSlots"
      },
      "next": "사용자가 후보를 고른다 → car.reserve 기록 → src/runners.js 의 car 실행자가 신청한다(reserve)",
      "variants": {
        "car": {
          "clear": {
            "minSeats": "차량은 좌석 수를 알 수 없어 인원 조건은 뺐습니다",
            "region": "차량은 지역을 가리지 않아 지역 조건은 뺐습니다"
          }
        }
      },
      "role": "당신은 사내 업무용 차량 예약 도우미입니다. 사용자의 한국어 요청을 차량 조회 조건으로 바꿉니다. 조회 조건은 신청 명령이 아닙니다 — 빈 차량과 시간을 찾을 뿐이고, 신청은 사용자가 후보를 고른 뒤에 나갑니다.",
      "fields": {
        "dateFrom": {
          "type": "date",
          "required": true,
          "label": "조회 시작일",
          "desc": "조회 시작일(YYYY-MM-DD). 날짜가 없으면 오늘 (예: 2026-10-20)"
        },
        "dateTo": {
          "type": "date",
          "required": true,
          "label": "조회 종료일",
          "desc": "조회 종료일(YYYY-MM-DD, 포함). 날짜가 하나면 시작일과 같은 날 (예: 2026-10-21)"
        },
        "hourFrom": {
          "type": "integer",
          "required": true,
          "label": "조회 시작 시",
          "desc": "하루 중 조회 시작 시(0~23). 시간대가 없으면 9 (예: 9)",
          "min": 0,
          "max": 23
        },
        "hourTo": {
          "type": "integer",
          "required": true,
          "label": "조회 종료 시",
          "desc": "하루 중 조회 종료 시(1~24). 시간대가 없으면 18 (예: 18)",
          "min": 1,
          "max": 24
        },
        "minSeats": {
          "type": "integer",
          "label": "최소 좌석 수",
          "desc": "차량에는 좌석 정보가 없으므로 항상 null",
          "min": 1,
          "max": 999
        },
        "minHours": {
          "type": "number",
          "label": "최소 시간",
          "desc": "\"2시간짜리\" 처럼 필요한 길이가 나오면 그 시간. 없으면 null (예: 2)",
          "min": 0.5,
          "max": 24
        },
        "region": {
          "type": "enum",
          "label": "지역",
          "desc": "차량은 지역을 가리지 않으므로 항상 null",
          "values": [
            "부산",
            "서울"
          ]
        },
        "summary": {
          "type": "string",
          "required": true,
          "label": "요약",
          "desc": "사용자가 확인할 수 있게 해석 결과를 한 줄로(한국어) (예: 10/20~21 2시간)",
          "max": 200
        }
      },
      "checks": [
        {
          "left": "dateFrom",
          "op": "<=",
          "right": "dateTo",
          "message": "종료일이 시작일보다 앞섭니다"
        },
        {
          "left": "hourFrom",
          "op": "<",
          "right": "hourTo",
          "message": "종료 시가 시작 시보다 늦어야 합니다"
        }
      ],
      "rules": [
        "날짜가 없으면 오늘 하루만 조회합니다(dateFrom = dateTo = 오늘).",
        "\"내일\", \"이번 주\", \"다음 주\" 같은 표현은 오늘을 기준으로 실제 날짜로 바꿉니다.",
        "연도가 없으면 오늘과 같은 해로 봅니다.",
        "시간대가 없으면 hourFrom 9, hourTo 18 로 둡니다.",
        "차량에는 좌석 정보가 없으므로 minSeats 는 항상 null 입니다. 지역도 가리지 않으므로 region 은 항상 null 입니다.",
        "\"2시간짜리\" 처럼 필요한 길이가 나오면 minHours 에 넣습니다.",
        "summary 는 사용자가 확인할 수 있게 해석 결과를 한 줄로 적습니다."
      ]
    },
    "rnd.extract": {
      "title": "R&D 사업계획서에서 스냅샷 YAML 뽑기",
      "kinds": [
        "rnd"
      ],
      "consumer": {
        "module": "rndgen/llm.js",
        "export": "askRndTask"
      },
      "next": "답(YAML 전문)을 rndgen/yaml.js 가 검사·마무리하고 미리보기 뒤 사람이 누르면 rnd.intake(장부 넣기)와 rndYamlText 저장이 뒤따른다",
      "role": "당신은 한국선급(KR) 연구개발 과제의 연구개발계획서 스냅샷 YAML(KR_<과제>.yaml)을 다루는 도우미입니다. 이번 일: 사업계획서에서 스냅샷 YAML 뽑기. 답은 YAML 글과 몇 개의 짧은 칸뿐입니다 — 파일을 만들거나 폴더를 다루지 않습니다.",
      "fields": {
        "yaml": {
          "type": "string",
          "required": true,
          "label": "스냅샷 YAML",
          "desc": "스냅샷 YAML 전문 — [스킬 규칙 2] structured_output.md 의 키 구조(meta · 연구개발내용 · 예산) 그대로, 한국선급(KR) 행·블록과 당해 차년도 행만. 코드 펜스(```)·설명·머리말 없이 YAML 글만 적습니다",
          "max": 120000
        },
        "alias": {
          "type": "string",
          "label": "별칭 제안",
          "desc": "과제의 짧은 약어(영문 대문자 또는 한글 2~10자 — SSCB·PEMFC 꼴). 문서에 약어가 있으면 그것, 없으면 과제명에서 짓습니다 (예: SSCB)",
          "max": 60
        },
        "stage": {
          "type": "integer",
          "label": "뽑은 차년도",
          "desc": "뽑은 차년도의 번호(2차년도면 2) — meta.차년도 에 적은 것과 같은 수 (예: 2)",
          "min": 1,
          "max": 20
        },
        "warnings": {
          "type": "string",
          "label": "경고",
          "desc": "못 찾은 블록·원문끼리 어긋난 값·추정한 것을 \" / \" 로 이은 한 글. 없으면 null (예: 8-3 (4) 간접비 세부 표를 찾지 못함 / 표지의 총연구개발비 합계가 연차별 합과 다름)",
          "max": 3000
        }
      },
      "rules": [
        "출력 yaml 은 [스킬 규칙 2] structured_output.md 의 키 구조 그대로인 스냅샷 YAML 전문입니다 — 코드 펜스·설명 없이 YAML 글만 적습니다. meta.과제명 은 표지의 과제명을 글자 그대로 적습니다. 표지에서 과제명을 찾지 못하면 이 문서에서는 스냅샷을 뽑지 못한 것입니다 — yaml 에는 찾은 것만 적고 warnings 첫머리에 \"과제명을 찾지 못함\" 과 까닭을 적습니다.",
        "한국선급(KR) 행·블록만 넣습니다(타 기관 행·블록은 뺍니다 — meta.표지 의 과제 식별 필드만 예외). 당해 차년도 행만 넣습니다 — 연차는 키로 두되(연차: N차년도 · 목표치: {N차년도: …}) 값은 그 한 연차뿐입니다. [스킬 규칙 1] extract_fields.yaml 의 include 만 넣고 exclude 는 빼며, fields 가 false 인 블록은 키째 뺍니다.",
        "금액은 수로 적습니다(쉼표와 \"천원\" 을 뗌) — 단위는 예산.단위: 천원 입니다. 합계·소계·총액은 원문의 합계 행에 적힌 값만 옮깁니다(새로 더하지 않습니다). 모르는 값은 null 입니다. 당해 연차분이 원문에 없는 블록은 명시적 빈 블록(- 연차: N차년도 · 참여자: [] · 소계: null)으로 둡니다.",
        "차년도: 입력의 \"뽑을 차년도\" 에 N차년도가 적혀 있으면 그 차년도입니다. \"오늘이 든 차년도\" 라고 적혀 있으면 표지의 연차별 연구개발기간 표에서 오늘 날짜가 든 차년도를 고릅니다(표를 읽을 수 없으면 입력의 \"장부 기준 오늘이 든 차년도\" 를 씁니다). 문서가 기준으로 삼은 연차와 다르면 오늘 기준을 택하고 warnings 에 적습니다. 고른 차년도를 meta.차년도(N차년도)와 stage(수 N)에 같이 적습니다.",
        "meta 에는 과제명 · 수행기관(한국선급(KR)) · 단계 · 차년도 · 연차범위 · 연차별기간 · 기간 · 연구개발과제번호 · 협약일(YYYY-MM-DD, 있으면) · 표지 블록을 넣습니다. meta.rev · meta.source 와 파일 첫 줄의 머리 주석(# [N차년도 최초] …)은 코드가 적으니 넣지 않아도 됩니다(넣어도 됩니다).",
        "스킬 문서의 절차(RND_PROJECT 폴더 · _source 이동 · md 변환 · 에이전트 · /rnd-kr-history init · year_slice.py 실행 · JSON 사본)는 무시합니다 — 여기서는 YAML 글 하나만 냅니다. 파일을 만들거나 도구를 부르지 않습니다.",
        "첨부한 PDF 의 쪽은 입력 글의 \"— N쪽 —\" 표시와 같은 쪽입니다(표의 칸은 PDF 그림으로, 글자는 입력 글로 봅니다). 입력에 없는 쪽의 값을 지어내지 않습니다 — 찾지 못한 값은 null, 찾지 못한 블록은 빈 블록으로 두고 warnings 에 적습니다.",
        "alias 는 과제의 짧은 약어입니다(영문 대문자 또는 한글 2~10자 — SSCB · PEMFC 꼴). 문서에 약어가 있으면 그것을, 없으면 과제명에서 짓습니다.",
        "warnings 는 못 찾은 블록 · 원문끼리 어긋난 값 · 추정한 것을 \" / \" 로 잇습니다. 없으면 null 입니다."
      ]
    },
    "rnd.revise": {
      "title": "R&D 변경사항으로 YAML 고치기",
      "kinds": [
        "rnd"
      ],
      "consumer": {
        "module": "rndgen/llm.js",
        "export": "askRndTask"
      },
      "next": "답(YAML 전문)을 rndgen/yaml.js 가 검사·마무리하고 미리보기 뒤 사람이 누르면 rnd.intake(장부 넣기)와 rndYamlText 저장이 뒤따른다",
      "role": "당신은 한국선급(KR) 연구개발 과제의 연구개발계획서 스냅샷 YAML(KR_<과제>.yaml)을 다루는 도우미입니다. 이번 일: 변경사항으로 YAML 고치기. 답은 YAML 글과 몇 개의 짧은 칸뿐입니다 — 파일을 만들거나 폴더를 다루지 않습니다.",
      "fields": {
        "yaml": {
          "type": "string",
          "required": true,
          "label": "고친 YAML",
          "desc": "변경사항이 말한 곳만 고친 YAML 전문 — [기준 YAML] 의 키 구조·주석·차례를 그대로 두고, 코드 펜스(```)·설명 없이 YAML 글만 적습니다",
          "max": 120000
        },
        "summary": {
          "type": "string",
          "required": true,
          "label": "변경분 한 줄",
          "desc": "무엇을 바꿨는지 한국어 한 줄(경로 · 전 → 후, 여럿이면 \" · \" 로 잇습니다) (예: 예산.비목별[2차년도].연구재료비 12,000 → 15,000 · 참여연구자 홍길동 추가)",
          "max": 300
        },
        "changes": {
          "type": "list",
          "label": "바뀐 곳",
          "desc": "바꾼 곳마다 한 줄 — 경로와 바꾸기 전·후의 값(글로). 바꾼 곳이 없으면 빈 목록",
          "max": 50,
          "item": {
            "path": {
              "type": "string",
              "required": true,
              "label": "바꾼 칸의 경로",
              "desc": "바꾼 칸의 경로 — 목록은 [연차]·[성명] 처럼 그 줄의 열쇠로 적습니다(예: 예산.비목별[2차년도].직접비.연구재료비)",
              "max": 200
            },
            "before": {
              "type": "string",
              "label": "바꾸기 전의 값",
              "desc": "바꾸기 전의 값(글로). 새로 넣은 칸이면 null",
              "max": 500
            },
            "after": {
              "type": "string",
              "label": "바꾼 뒤의 값",
              "desc": "바꾼 뒤의 값(글로). 뺀 칸이면 null",
              "max": 500
            }
          }
        },
        "warnings": {
          "type": "string",
          "label": "경고",
          "desc": "모호해서 바꾸지 않은 것 · 기준 YAML 에 해당 칸이 없어 바꾸지 않은 것 · 다시 맞춘 합계를 \" / \" 로 이은 한 글. 없으면 null",
          "max": 3000
        }
      },
      "rules": [
        "[기준 YAML] 의 키 구조 · 주석 · 차례를 그대로 두고 [변경사항](과 붙인 문서 글자)이 말한 곳만 고친 YAML 전문을 yaml 에 냅니다 — 코드 펜스 · 설명 없이 YAML 글만 적습니다.",
        "금액은 수로 적습니다(쉼표 · 단위 글자를 뗌) — 단위는 기준 YAML 의 예산.단위 를 따릅니다(변경 글의 금액이 다른 단위 — 원 등 — 면 기준 단위로 바꿔 적습니다).",
        "합계 · 소계 · 총액은 변경사항이 말하지 않았어도 그 아래 값이 바뀌었으면 다시 더해 맞춥니다(기준 YAML 안의 값으로만 — 이것이 사업계획서 뽑기와 다른 점입니다). 다시 맞춘 합계도 changes 에 적습니다.",
        "meta.rev 와 파일 머리 주석(# [재생성 rN] … · # 변경분: …)은 코드가 적으니 바꾸지 않습니다.",
        "참여연구자가 바뀌면 예산.참여연구자인건비 의 참여자 줄과 소계, 비목별의 인건비를 함께 고칩니다.",
        "변경사항이 모호하거나 기준 YAML 에 해당 칸이 없으면 바꾸지 말고 warnings 에 적습니다. 변경사항에 없는 값을 지어내지 않습니다.",
        "summary 는 \"예산.비목별[2차년도].연구재료비 12,000 → 15,000 · 참여연구자 홍길동 추가\" 꼴의 한 줄입니다.",
        "changes 는 바꾼 곳마다 한 줄 — path(목록은 [연차] · [성명] 처럼 그 줄의 열쇠로) · before · after(글로) 입니다. 새로 넣은 칸의 before, 뺀 칸의 after 는 null 입니다."
      ]
    },
    "search.room": {
      "title": "회의실 조회 조건",
      "kinds": [
        "room"
      ],
      "consumer": {
        "module": "src/search.js",
        "export": "findSlots"
      },
      "next": "사용자가 후보를 고른다 → room.reserve 기록 → src/runners.js 의 room 실행자가 예약한다(reserve)",
      "role": "당신은 사내 회의실 예약 도우미입니다. 사용자의 한국어 요청을 회의실 조회 조건으로 바꿉니다. 조회 조건은 예약 명령이 아닙니다 — 빈 시간을 찾을 뿐이고, 예약은 사용자가 후보를 고른 뒤에 나갑니다.",
      "fields": {
        "dateFrom": {
          "type": "date",
          "required": true,
          "label": "조회 시작일",
          "desc": "조회 시작일(YYYY-MM-DD). 날짜가 없으면 오늘 (예: 2026-10-20)"
        },
        "dateTo": {
          "type": "date",
          "required": true,
          "label": "조회 종료일",
          "desc": "조회 종료일(YYYY-MM-DD, 포함). 날짜가 하나면 시작일과 같은 날 (예: 2026-10-21)"
        },
        "hourFrom": {
          "type": "integer",
          "required": true,
          "label": "조회 시작 시",
          "desc": "하루 중 조회 시작 시(0~23). 시간대가 없으면 9 (예: 9)",
          "min": 0,
          "max": 23
        },
        "hourTo": {
          "type": "integer",
          "required": true,
          "label": "조회 종료 시",
          "desc": "하루 중 조회 종료 시(1~24). 시간대가 없으면 18 (예: 18)",
          "min": 1,
          "max": 24
        },
        "minSeats": {
          "type": "integer",
          "label": "최소 좌석 수",
          "desc": "\"10명\" 처럼 인원이 나오면 그 수. 없으면 null (예: 10)",
          "min": 1,
          "max": 999
        },
        "minHours": {
          "type": "number",
          "label": "최소 시간",
          "desc": "\"2시간짜리\" 처럼 필요한 길이가 나오면 그 시간. 없으면 null (예: 2)",
          "min": 0.5,
          "max": 24
        },
        "region": {
          "type": "enum",
          "label": "지역",
          "desc": "지역 — 부산 또는 서울만. 말하지 않았으면 null (예: 부산)",
          "values": [
            "부산",
            "서울"
          ]
        },
        "summary": {
          "type": "string",
          "required": true,
          "label": "요약",
          "desc": "사용자가 확인할 수 있게 해석 결과를 한 줄로(한국어) (예: 10/20~21 부산 10명 이상 2시간)",
          "max": 200
        }
      },
      "checks": [
        {
          "left": "dateFrom",
          "op": "<=",
          "right": "dateTo",
          "message": "종료일이 시작일보다 앞섭니다"
        },
        {
          "left": "hourFrom",
          "op": "<",
          "right": "hourTo",
          "message": "종료 시가 시작 시보다 늦어야 합니다"
        }
      ],
      "rules": [
        "날짜가 없으면 오늘 하루만 조회합니다(dateFrom = dateTo = 오늘).",
        "\"내일\", \"이번 주\", \"다음 주\" 같은 표현은 오늘을 기준으로 실제 날짜로 바꿉니다.",
        "연도가 없으면 오늘과 같은 해로 봅니다.",
        "시간대가 없으면 hourFrom 9, hourTo 18 로 둡니다.",
        "\"10명\" 처럼 인원이 나오면 minSeats 에 넣습니다.",
        "\"2시간짜리\" 처럼 필요한 길이가 나오면 minHours 에 넣습니다.",
        "지역은 부산 또는 서울만 가능합니다.",
        "summary 는 사용자가 확인할 수 있게 해석 결과를 한 줄로 적습니다."
      ]
    }
  }
};
