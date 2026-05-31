package io.github.gjaku1031.kenblog.global.security

import io.github.gjaku1031.kenblog.account.domain.UserRole
import io.github.gjaku1031.kenblog.account.repository.AccountRepository
import org.springframework.security.core.userdetails.User
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.security.core.userdetails.UserDetailsService
import org.springframework.security.core.userdetails.UsernameNotFoundException
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/**
 * [AccountRepository]의 저장 계정을 Spring Security 인증 정보로 변환.
 *
 * 엔티티 자체를 세션에 넣지 않으며 [User]는 인증 후 비밀번호 해시를 지울 수 있음.
 *
 * @property repository 사용자 이름을 조회할 구체 저장소
 */
@Service
class SecurityUserDetailsService(private val repository: AccountRepository) : UserDetailsService {
    /**
     * 정확한 계정명의 해시와 [UserRole] 권한을 로드.
     *
     * @param username 대소문자를 구분하는 계정명
     * @return 인증 제공자가 사용할 [UserDetails]
     * @throws UsernameNotFoundException 계정이 없을 때; 공개 응답은 비밀번호 오류와 동일하게 처리됨
     */
    @Transactional(readOnly = true)
    override fun loadUserByUsername(username: String): UserDetails {
        val account = repository.findByUsername(username) ?: throw UsernameNotFoundException("User not found")
        return User.withUsername(account.username)
            .password(account.passwordHash)
            .roles(account.role.name)
            .build()
    }
}
