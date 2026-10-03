import java.sql.DriverManager;
import java.sql.SQLException;

/**
 * 운영과 같은 Connector/J에서 TLS 연결 성공·실패를 검사하는 독립 실행 도구
 */
final class MysqlTlsProbe {
    /**
     * 인수의 JDBC URL과 예상 결과만 사용하며 예외 메시지·접속 정보는 출력하지 않음
     */
    public static void main(String[] args) throws Exception {
        boolean expected = Boolean.parseBoolean(args[1]);
        try (var connection = DriverManager.getConnection(args[0], "tls_probe", "ci_tls_only")) {
            if (!expected || !connection.isValid(3)) throw new AssertionError("TLS boundary accepted an invalid connection");
        } catch (SQLException failure) {
            if (expected) throw new AssertionError("Expected TLS connection failed", failure);
            // 단순 계정·SQL 오류를 인증서 검증 성공으로 오인하지 않음
            if (failure.getSQLState() == null || !failure.getSQLState().startsWith("08")) throw failure;
        }
    }
}
