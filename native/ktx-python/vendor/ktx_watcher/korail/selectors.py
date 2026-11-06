"""Only selectors referenced by the query-only subset."""
SEARCH_URL = "https://www.korail.com/ticket/search/general"

RESULT_URL_PATTERN = "**/search/list*"

ORIGIN_INPUT = "input[name='txtGoStart'], input#labelstart"

DEST_INPUT = "input[name='txtGoEnd'], input#labelend"

ORIGIN_BTN = ".selectAreaWrap .start a.btn_pop-open"

DEST_BTN = ".selectAreaWrap .end a.btn_pop-open"

DATE_INPUT = "input#startDate"

DATE_PICKER_BTN = "a.btn_pop.btn_d-day"

SEARCH_SUBMIT = "button.btn_lookup"

RESULT_SEARCH_SUBMIT = ".selectAreaWrap button.btn_bn-blue"

RESULT_PEOPLE_INPUT = "input#labelple"

SEARCH_FORM_DETECT = "button.btn_lookup, input[name='txtGoStart']"

SRT_RADIO_Y = "input[name='adjStnScdlOfrFlg2'][value='Y']"

SRT_RADIO_N = "input[name='adjStnScdlOfrFlg2'][value='N']"

SRT_RESULT_CHECKBOX = "input#adjStnScdlOfrFlg2[type='checkbox']"

SRT_RESULT_CHECKBOX_LABEL = "label[for='adjStnScdlOfrFlg2']"

PEOPLE_BTN = "a.data.btn_pop, .selectAreaWrap a.btn_recom"

PEOPLE_POPUP = ".layerWrap.personnel_pop_wrap"

PEOPLE_POPUP_APPLY = ".layerWrap.personnel_pop_wrap .btnWrap button.btn_bn-blue"

PEOPLE_POPUP_CANCEL = ".layerWrap.personnel_pop_wrap .btnWrap button.btn_pop-close"

PEOPLE_CONFIRM_YES = ".layerWrap:has(.confirm_message) button.btn_bn-blue"

PASSENGER_TYPE_PREFIX = {
    "어른": "어른",
    "어린이": "어린이",
    "유아": "유아",
    "경로": "경로",
    "중증장애인": "중증",
    "경증장애인": "경증",
    "국가유공자": "국가유공자",
}

STATION_POPUP = ".layerWrap.type_tranin-station-pop_wrap"

STATION_POPUP_INPUT = "input[name='searchTxt']"

STATION_POPUP_OPTION = ".layerWrap.type_tranin-station-pop_wrap span.ch_tag a"

DATE_POPUP = ".layerWrap.type_date-pop_wrap"

DATE_POPUP_NEXT = ".layerWrap.type_date-pop_wrap .slick-arrow.slick-next"

DATE_POPUP_PREV = ".layerWrap.type_date-pop_wrap .slick-arrow.slick-prev"

DATE_POPUP_APPLY = ".layerWrap.type_date-pop_wrap .btn_wrap button.btn_bn-blue"

DATE_POPUP_CANCEL = ".layerWrap.type_date-pop_wrap .btn_wrap button.btn_pop-close"

RESULT_EMPTY_TEXT = "해당 스케줄에 운행하는 열차가 없습니다"

RESULT_EMPTY_MARKER = ".tck_confirm_no-data"

TRAIN_TYPE_TAB = {
    "전체": "ul.tab_bar button.all",
    "KTX": "ul.tab_bar button:has(div.korail_logo_tab)",
    "KTX-산천": "ul.tab_bar button:has(div.korail_logo_tab)",
    "새마을": "ul.tab_bar button:has(div.saemaeul_logo_tab)",
    "ITX-새마을": "ul.tab_bar button:has(div.saemaeul_logo_tab)",
    "무궁화": "ul.tab_bar button:has(div.mugung_logo_tab)",
    "누리로": "ul.tab_bar button:has(div.mugung_logo_tab)",
    "ITX-청춘": "ul.tab_bar button:has(div.chung_logo_tab)",
}

MACRO_NOTICE_KEYWORDS = (
    "-8002",
    "-8003",
    "미허가",
    "개발자도구",
    "비정상적인 접속",
    "안내 메시지",
    "안내 메세지",  # 사이트가 두 철자를 혼용 (로그인 모달은 '메세지')
)

MODAL_CONFIRM_BUTTON = "button:has-text('확인')"

MODAL_PROCEED_BUTTON = "button:text-is('네'), a:text-is('네')"

NOTICE_MODAL_KEYWORDS = (
    "창닫기",
    "그만보기",
)

NOTICE_MODAL_DISMISS_BUTTON = (
    "button.btn_pop-close, "
    "button:has-text('창닫기'), "
    "a:has-text('창닫기')"
)

NOTICE_MODAL_HIDE_TODAY_CHECKBOX = (
    "label:has-text('그만보기'), "
    "input[id^='popClose'][type='checkbox']"
)
