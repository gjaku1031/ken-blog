package io.github.gjaku1031.kenblog.web

import org.springframework.stereotype.Controller
import org.springframework.web.bind.annotation.GetMapping

/** 동일 출처의 관리자 정적 자산으로 진입하고 모든 변경 권한은 기존 REST API에서 검사. */
@Controller
class ManagementPageController {
    /** 관리자 앱의 공개 진입 문서만 전달하며 세션·원고를 HTML에 삽입하지 않음. */
    @GetMapping("/manage", "/manage/")
    fun index(): String = "forward:/manage/index.html"
}
