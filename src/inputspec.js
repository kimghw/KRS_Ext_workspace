// 생성물 — 고치지 않는다. input.yaml 을 고치고 `node tools/gen-input.mjs` 를 돌린다.
export const INPUT_SPEC = {
  "version": 1,
  "tasks": {
    "receipt": {
      "title": "출장 증빙(숙박 영수증·예약서·항공권·출장지에서 결제한 영수증) 읽기",
      "kinds": [
        "trip"
      ],
      "consumer": {
        "module": "src/after.js",
        "export": "afterPlan"
      },
      "next": "src/after.js afterPlan 이 숙박비·교통비·항공 마일리지로 묶는다 → src/trip.js tripAfterSave 가 eclass 여비계산서 사후정산(AfterTrip/Save)에 올린다",
      "role": "당신은 사내 출장 여비 정산 도우미입니다. 첨부한 문서 한 장(숙박 영수증·인보이스·숙박 예약 확인서·항공권·기차표·카드 영수증·전자영수증 등의 이미지나 PDF)을 읽어 여비계산서 정산에 넣을 값을 뽑습니다. 입력에는 출장 정보(기간·출장지·출장자)와 파일 이름이 들어 있습니다.",
      "fields": {
        "docType": {
          "type": "enum",
          "required": true,
          "values": [
            "lodging_receipt",
            "lodging_booking",
            "flight_ticket",
            "flight_receipt",
            "train_ticket",
            "bus_ticket",
            "other_receipt",
            "unknown"
          ],
          "desc": "문서 종류. lodging_receipt(숙박 결제 영수증·인보이스)·lodging_booking(숙박 예약 확인서)·flight_ticket(항공권·탑승권·e-티켓)·flight_receipt(항공권 결제 영수증)·train_ticket(기차표)·bus_ticket(버스표)·other_receipt(그 밖의 영수증)·unknown(모름)"
        },
        "vendor": {
          "type": "string",
          "max": 100,
          "desc": "업체명(실제로 묵은 숙박업소·가맹점 이름 또는 항공사)"
        },
        "seller": {
          "type": "string",
          "max": 100,
          "desc": "구매처 — 돈을 받은 곳. 예약 대행사를 거쳐 샀으면 그 대행사(아고다·부킹닷컴·야놀자 등), 직접 결제했으면 그 업체"
        },
        "sellerBiz": {
          "type": "string",
          "max": 100,
          "desc": "구매처의 사업자명(문서에 적힌 상호·법인명 — \"Agoda Company Pte. Ltd.\", \"(주)야놀자\"). 적혀 있지 않으면 null"
        },
        "bizNo": {
          "type": "string",
          "max": 20,
          "desc": "구매처의 사업자등록번호(000-00-00000). 적혀 있지 않으면 null"
        },
        "payDate": {
          "type": "date",
          "desc": "결제일(영수증의 승인·결제 날짜)"
        },
        "payPlace": {
          "type": "string",
          "max": 100,
          "desc": "결제한 곳 — 영수증에 적힌 가맹점 주소나 지역(시·군·구까지). 적혀 있지 않으면 null"
        },
        "atDestination": {
          "type": "boolean",
          "desc": "그 밖의 영수증(other_receipt)이 입력의 출장지와 같은 지역(시·군·구)에서 결제된 것인가. 영수증의 주소·지점명으로 가리고, 알 수 없으면 null"
        },
        "checkIn": {
          "type": "date",
          "desc": "숙박 체크인 날짜"
        },
        "checkOut": {
          "type": "date",
          "desc": "숙박 체크아웃 날짜"
        },
        "nights": {
          "type": "integer",
          "min": 1,
          "max": 60,
          "desc": "숙박 일수(박)"
        },
        "total": {
          "type": "number",
          "min": 0,
          "desc": "총 결제 금액(숫자만) — 문서에 적힌 화폐(currency)의 금액"
        },
        "totalKRW": {
          "type": "number",
          "min": 0,
          "desc": "외화 문서에 원화로 결제·청구된 금액이 같이 적혀 있을 때 그 원화 금액. 원화 문서이거나 적혀 있지 않으면 null"
        },
        "supply": {
          "type": "number",
          "min": 0,
          "desc": "공급가액(부가세를 뺀 금액) — 문서에 따로 적혀 있을 때만"
        },
        "vat": {
          "type": "number",
          "min": 0,
          "desc": "부가세 — 문서에 따로 적혀 있을 때만"
        },
        "currency": {
          "type": "enum",
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
          ],
          "desc": "화폐(ISO 세 글자 코드)"
        },
        "corporateCard": {
          "type": "boolean",
          "desc": "법인카드로 결제했다고 문서에 적혀 있는가"
        },
        "transport": {
          "type": "enum",
          "values": [
            "plane",
            "train",
            "subway",
            "ship",
            "bus",
            "taxi"
          ],
          "desc": "교통비 문서(표·교통비 영수증)의 교통수단. plane(비행기)·train(기차)·subway(지하철)·ship(선박)·bus(버스)·taxi(택시). 교통비 문서가 아니면 null"
        },
        "airline": {
          "type": "string",
          "max": 50,
          "desc": "항공사 이름(한국어로 — 대한항공·아시아나항공·에어프레미아·제주항공 등)"
        },
        "flightNo": {
          "type": "string",
          "max": 20,
          "desc": "편명(KE1234)"
        },
        "flightDate": {
          "type": "date",
          "desc": "탑승일(비행기·기차·버스·택시 등을 탄 날)"
        },
        "depPlace": {
          "type": "string",
          "max": 50,
          "desc": "출발지(도시·공항·역)"
        },
        "arrPlace": {
          "type": "string",
          "max": 50,
          "desc": "도착지(도시·공항·역)"
        },
        "depTime": {
          "type": "time",
          "desc": "출발 시각"
        },
        "arrTime": {
          "type": "time",
          "desc": "도착 시각"
        },
        "seatClass": {
          "type": "string",
          "max": 20,
          "desc": "좌석 등급(일반석·비즈니스 등)"
        },
        "retDate": {
          "type": "date",
          "desc": "왕복표의 돌아오는 편 탑승일. 편도면 null"
        },
        "retDepPlace": {
          "type": "string",
          "max": 50,
          "desc": "왕복표의 돌아오는 편 출발지. 편도면 null"
        },
        "retArrPlace": {
          "type": "string",
          "max": 50,
          "desc": "왕복표의 돌아오는 편 도착지. 편도면 null"
        },
        "retDepTime": {
          "type": "time",
          "desc": "왕복표의 돌아오는 편 출발 시각. 편도면 null"
        },
        "retFlightNo": {
          "type": "string",
          "max": 20,
          "desc": "왕복표의 돌아오는 편 편명. 편도면 null"
        },
        "mileage": {
          "type": "integer",
          "min": 0,
          "max": 100000,
          "desc": "이 항공권으로 적립되는 마일리지(문서에 적혀 있을 때만)"
        },
        "passenger": {
          "type": "string",
          "max": 50,
          "desc": "탑승자·투숙자 이름"
        },
        "extra": {
          "type": "string",
          "max": 300,
          "desc": "계산서에 넣지 않지만 알아 둘 추가 정보(조식 포함·예약번호·취소 규정·수하물 등). 없으면 null"
        },
        "summary": {
          "type": "string",
          "required": true,
          "max": 200,
          "desc": "문서를 한 줄로 요약(한국어)"
        }
      },
      "checks": [
        {
          "left": "checkIn",
          "op": "<=",
          "right": "checkOut",
          "drop": "checkOut",
          "message": "체크아웃이 체크인보다 앞서 체크아웃은 뺐습니다"
        }
      ],
      "rules": [
        "문서에 적힌 것만 채웁니다. 적혀 있지 않은 값은 null 이고, 추측하거나 지어내지 않습니다.",
        "증빙은 **원본 문서**(영수증·인보이스·예약 확인서·표, 또는 그것을 보여 주는 예약 사이트·앱의 화면)입니다. 정산 프로그램의 화면을 찍은 것 — 여비계산서·사후정산 입력 화면, \"증빙 넣는 곳\"·\"사후정산\"·\"올렸습니다\"·\"보관했습니다\" 같은 글이 보이는 출장 카드 화면, 읽은 증빙의 요약이나 목록만 적힌 화면 — 은 증빙이 아닙니다. 그런 화면이면 docType 은 unknown 이고 나머지 값은 null 이며, summary 에 무슨 화면인지 적습니다.",
        "금액은 쉼표·통화 기호 없이 숫자만 적습니다. 날짜는 YYYY-MM-DD, 시각은 24시간제 HH:MM 입니다.",
        "숙박 예약 확인서(결제 영수증이 아닌 것)는 lodging_booking 이고, 예약 금액이 있으면 total 에 적습니다.",
        "seller 는 **돈을 받은 곳(구매처)**입니다. 예약 대행사(아고다·부킹닷컴·호텔스닷컴·익스피디아·트립닷컴·야놀자·여기어때 등)를 거쳐 결제한 문서면 그 대행사를 한국에서 부르는 이름으로 적고(Agoda → 아고다, Booking.com → 부킹닷컴), 숙박업소나 가맹점에 직접 결제한 문서면 그 업체 이름을 적습니다. vendor 에는 언제나 실제로 묵은 숙박업소(또는 가맹점·항공사) 이름을 적습니다.",
        "sellerBiz 는 문서에 적힌 구매처의 사업자명(상호·법인명)이고 bizNo 는 그 구매처의 사업자등록번호입니다. 문서에 적혀 있을 때만 적습니다.",
        "total 은 문서에 적힌 화폐의 금액이고 currency 는 그 화폐입니다. 외화 문서에 원화로 결제·청구된 금액이 같이 적혀 있으면 totalKRW 에 적습니다 — 환율로 셈하지 않습니다. 원화 문서면 totalKRW 는 null 입니다.",
        "supply(공급가액)·vat(부가세)는 문서에 따로 적혀 있을 때만 적습니다. 총액에서 셈해 넣지 않습니다.",
        "체크인·체크아웃이 모두 있으면 nights 는 그 차이(박 수)입니다.",
        "항공권이면 airline 은 한국어 이름으로 적습니다(Korean Air → 대한항공, Asiana → 아시아나항공).",
        "왕복표(한 장에 가는 편과 오는 편이 같이 있는 것)면 가는 편을 flightDate·depPlace·arrPlace·depTime·flightNo 에, 오는 편을 retDate·retDepPlace·retArrPlace·retDepTime·retFlightNo 에 적습니다. total 은 문서의 총 결제 금액 그대로입니다.",
        "편도표면 ret 으로 시작하는 칸은 모두 null 입니다. 여정이 셋 이상이면 처음 두 여정을 적고 나머지는 extra 에 적습니다.",
        "기차표(train_ticket)·버스표(bus_ticket)도 항공권처럼 탑승일(flightDate)·출발지(depPlace)·도착지(arrPlace)·출발 시각·도착 시각·좌석 등급(seatClass)·total 을 적습니다. airline·flightNo 는 null 입니다.",
        "transport 는 교통비 문서일 때만 적습니다 — 항공권은 plane, 기차표는 train, 버스표는 bus 입니다. 택시·지하철·선박처럼 표 종류가 따로 없는 교통비 영수증은 docType 을 other_receipt 로 두고 transport 에 수단을 적으며, 탄 날을 flightDate 에, 출발지·도착지가 적혀 있으면 depPlace·arrPlace 에 적습니다. 식당·카페·숙박처럼 교통비가 아니면 transport 는 null 입니다.",
        "그 밖의 영수증(other_receipt — 식당·카페·편의점·택시 등의 카드 영수증)은 vendor·payDate·total 과 함께 payPlace(가맹점 주소·지역)를 적고, 그곳이 입력의 출장지와 같은 지역이면 atDestination 을 true, 다른 지역이면 false 로 적습니다. 주소·지점명이 없어 알 수 없으면 null 입니다 — 추측하지 않습니다.",
        "atDestination 은 other_receipt 일 때만 true/false 이고, 그 밖의 문서에서는 null 입니다.",
        "corporateCard 는 문서에 법인카드라고 적혀 있을 때만 true 이고, 알 수 없으면 null 입니다.",
        "summary 는 무엇의 어떤 문서인지 한 줄로 적습니다(\"○○호텔 1박 결제 영수증 143,000원\")."
      ]
    },
    "diagnose": {
      "title": "예약 실패 원인 설명",
      "kinds": [
        "room",
        "car"
      ],
      "consumer": {
        "module": "src/llm.js",
        "export": "diagnoseSmart"
      },
      "next": "없음 — 화면·활동 기록에 표시만 한다",
      "role": "당신은 ASP.NET WebForms 사내 시스템에 회의실·차량 예약을 자동 제출하는 프로그램의 진단 도우미입니다. 예약을 제출했지만 다시 조회했을 때 그 예약이 보이지 않았습니다. 입력은 저장 요청에 보낸 값과, 응답 페이지에서 **제출 전과 달라진 부분만** 추린 요약(JSON)입니다. 회의실인지 차량인지는 요약의 \"대상\" 이 알려 줍니다.",
      "fields": {
        "verdict": {
          "type": "enum",
          "required": true,
          "values": [
            "rejected",
            "maybe_saved",
            "unknown"
          ],
          "desc": "사이트가 거부한 것인지(rejected), 저장은 된 것 같은데 화면에 안 보이는 것인지(maybe_saved), 알 수 없는지(unknown)"
        },
        "siteMessage": {
          "type": "string",
          "max": 300,
          "desc": "사이트가 사용자에게 실제로 띄운 문구"
        },
        "cause": {
          "type": "string",
          "required": true,
          "max": 400,
          "desc": "원인을 한국어 한두 문장으로"
        },
        "fix": {
          "type": "string",
          "max": 200,
          "desc": "사용자가 할 수 있는 조치를 한국어 한 문장으로"
        }
      },
      "rules": [
        "응답에 새로 나타난 alert/스크립트나 안내 문구가 거부 사유를 말하고 있으면 verdict 는 rejected 입니다.",
        "거부 흔적이 전혀 없고 폼 값도 정상이면 verdict 는 maybe_saved 입니다(승인 대기 등으로 목록에 안 보일 수 있음).",
        "근거가 부족하면 verdict 는 unknown 입니다.",
        "예약이 됐는지 안 됐는지는 이미 재조회로 확인했습니다. 원인만 설명합니다.",
        "추측을 사실처럼 쓰지 않습니다. 근거가 없으면 없다고 합니다.",
        "한국어로, 짧고 구체적으로 씁니다."
      ]
    }
  }
};
