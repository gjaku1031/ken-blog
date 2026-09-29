package io.github.gjaku1031.kenblog.attachment.storage

import io.github.gjaku1031.kenblog.attachment.domain.AttachmentFailure
import jakarta.annotation.PreDestroy
import java.io.InputStream
import java.net.URI
import java.time.Duration
import java.util.UUID
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Component
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider
import software.amazon.awssdk.core.checksums.RequestChecksumCalculation
import software.amazon.awssdk.core.checksums.ResponseChecksumValidation
import software.amazon.awssdk.core.exception.SdkException
import software.amazon.awssdk.core.sync.RequestBody
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.s3.S3Client
import software.amazon.awssdk.services.s3.S3Configuration
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest
import software.amazon.awssdk.services.s3.model.GetObjectRequest
import software.amazon.awssdk.services.s3.model.NoSuchKeyException
import software.amazon.awssdk.services.s3.model.PutObjectRequest

/**
 * 기존 비공개 OCI Object Storage 버킷을 S3 호환 SigV4·path-style 방식으로 사용.
 *
 * 다섯 연결값이 모두 없으면 클라이언트를 만들지 않고 첨부 요청에 503을 반환함.
 * 일부만 설정되거나 HTTPS·접두사가 잘못되면 기동을 중단함.
 */
@Component
class OciObjectStorage(
    @Value("\${app.attachment.storage.endpoint}") endpoint: String,
    @Value("\${app.attachment.storage.region}") region: String,
    @Value("\${app.attachment.storage.bucket}") private val bucket: String,
    @Value("\${app.attachment.storage.access-key}") accessKey: String,
    @Value("\${app.attachment.storage.secret-key}") secretKey: String,
    @Value("\${app.attachment.storage.key-prefix}") private val keyPrefix: String,
) {
    private val client: S3Client?

    init {
        val settings = listOf(endpoint, region, bucket, accessKey, secretKey)
        check(settings.all(String::isBlank) || settings.none(String::isBlank)) {
            "OCI Object Storage connection settings must be supplied together"
        }
        check(keyPrefix.length in 1..160 && keyPrefix.matches(Regex("[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*"))) {
            "OCI Object Storage key prefix is invalid"
        }
        client = if (settings.all(String::isBlank)) null else {
            val uri = runCatching { URI(endpoint) }.getOrNull()
            check(uri != null && uri.scheme == "https" && uri.host != null && uri.userInfo == null &&
                (uri.path.isNullOrEmpty() || uri.path == "/") && uri.query == null && uri.fragment == null) {
                "OCI Object Storage endpoint must be an HTTPS origin"
            }
            check(bucket.matches(Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,254}"))) { "OCI Object Storage bucket is invalid" }
            check(region.matches(Regex("[a-z0-9-]+"))) { "OCI Object Storage region is invalid" }
            S3Client.builder()
                .endpointOverride(uri)
                .region(Region.of(region))
                .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create(accessKey, secretKey)))
                .forcePathStyle(true)
                .serviceConfiguration(S3Configuration.builder().chunkedEncodingEnabled(false).build())
                .requestChecksumCalculation(RequestChecksumCalculation.WHEN_REQUIRED)
                .responseChecksumValidation(ResponseChecksumValidation.WHEN_REQUIRED)
                .httpClientBuilder(UrlConnectionHttpClient.builder()
                    .connectionTimeout(Duration.ofSeconds(5))
                    .socketTimeout(Duration.ofSeconds(30)))
                .overrideConfiguration { it.apiCallTimeout(Duration.ofSeconds(30)).apiCallAttemptTimeout(Duration.ofSeconds(20)) }
                .build()
        }
    }

    /**
     * 객체 key가 외부 값 없이 생성되도록 전용 접두사에 UUID를 결합.
     *
     * @param extension 실제 이미지 형식에서 판별한 `jpg` 또는 `png`
     * @return 단일 첨부에만 쓰는 저장소 key
     */
    fun newKey(extension: String): String = "$keyPrefix/${UUID.randomUUID()}.$extension"

    /**
     * 저장소가 설정되어 있는지 HTTP 진입 시 확인.
     *
     * @throws AttachmentFailure 다섯 연결값을 모두 비운 기본 실행일 때
     */
    fun requireConfigured() {
        activeClient()
    }

    /**
     * 검증된 원본 바이트를 비공개 버킷에 저장.
     *
     * @param key 서버에서 생성한 객체 key
     * @param bytes 최대 10 MiB 원본 이미지
     * @param contentType 바이트에서 판별한 MIME
     * @throws AttachmentFailure OCI 쓰기 또는 네트워크 실패 시
     */
    fun put(key: String, bytes: ByteArray, contentType: String) {
        try {
            activeClient().putObject(
                PutObjectRequest.builder().bucket(bucket).key(key).contentType(contentType).build(),
                RequestBody.fromBytes(bytes),
            )
        } catch (ex: AttachmentFailure) {
            throw ex
        } catch (_: SdkException) {
            throw unavailable()
        }
    }

    /**
     * READY 객체의 입력 스트림을 열어 Spring HTTP 응답에서 닫도록 전달.
     *
     * @param key DB에서 읽은 서버 생성 key
     * @return OCI 응답 본문의 열린 [InputStream]
     * @throws AttachmentFailure 객체를 읽을 수 없을 때
     */
    fun open(key: String): InputStream = try {
        activeClient().getObject(GetObjectRequest.builder().bucket(bucket).key(key).build())
    } catch (ex: AttachmentFailure) {
        throw ex
    } catch (_: SdkException) {
        throw unavailable()
    }

    /**
     * 이미 없는 key도 완료로 취급하며 한 첨부의 객체만 삭제.
     *
     * @param key DB가 추적하는 서버 생성 key
     * @throws AttachmentFailure 저장소 삭제 결과가 불확실할 때
     */
    fun delete(key: String) {
        try {
            activeClient().deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(key).build())
        } catch (_: NoSuchKeyException) {
            return
        } catch (ex: AttachmentFailure) {
            throw ex
        } catch (_: SdkException) {
            throw unavailable()
        }
    }

    /** Spring 종료 시 열려 있는 SDK HTTP 연결을 닫음. */
    @PreDestroy
    fun close() {
        client?.close()
    }

    /** @return 설정된 S3 호환 클라이언트, 없으면 안전한 503 오류. */
    private fun activeClient(): S3Client = client ?: throw unavailable()

    /** @return 공급자 원문과 비밀값을 숨기는 고정 503 오류. */
    private fun unavailable(): AttachmentFailure = AttachmentFailure(HttpStatus.SERVICE_UNAVAILABLE, "첨부 저장소를 사용할 수 없습니다.")
}
