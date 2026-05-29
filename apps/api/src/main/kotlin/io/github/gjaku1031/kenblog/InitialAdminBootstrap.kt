package io.github.gjaku1031.kenblog

import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.ApplicationArguments
import org.springframework.boot.ApplicationRunner
import org.springframework.stereotype.Component

/**
 * 선택적 외부 설정을 [AccountService]에 전달하여 시작 시 관리자 계정을 준비.
 *
 * 설정이 둘 다 비어 있으면 계정을 만들지 않음. 준비에 실패하면 애플리케이션 기동 실패.
 *
 * @property service 계정 준비와 트랜잭션을 처리하는 서비스
 * @property username 외부에서 주입한 관리자 이름
 * @property passwordHash 외부에서 주입한 `{bcrypt}` 해시
 */
@Component
class InitialAdminBootstrap(
    private val service: AccountService,
    @Value("\${app.bootstrap.admin.username}") private val username: String,
    @Value("\${app.bootstrap.admin.password-hash}") private val passwordHash: String,
) : ApplicationRunner {
    /**
     * 서버 시작 중 [AccountService.ensureInitialAdmin]을 실행.
     *
     * @param args Spring 실행 인자; 계정 준비에는 사용하지 않음
     * @throws IllegalStateException 초기 설정이나 DB 계정 상태가 계약과 다를 때
     */
    override fun run(args: ApplicationArguments) {
        service.ensureInitialAdmin(username, passwordHash)
    }
}
