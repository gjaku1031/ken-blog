package io.github.gjaku1031.kenblog;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import io.github.gjaku1031.kenblog.attachment.domain.AttachmentFailure;
import io.github.gjaku1031.kenblog.attachment.storage.LocalAssetStorage;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.HttpStatus;

import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.List;

/**
 * 실제 디스크에서 기존 key·재기동 보존·경로 격리·실패 시 파일 보존 검증
 */
final class LocalAssetStorageTest {
    /**
     * 테스트 임시 디렉터리
     */
    @TempDir Path directory;

    /**
     * 셸 umask와 무관한 정상 POSIX 저장 경로 준비
     */
    private Path privateDirectory(Path path) throws Exception {
        Files.createDirectories(path);
        Path current = path;
        while (current.startsWith(directory) && !current.equals(directory)) {
            Files.setPosixFilePermissions(current, PosixFilePermissions.fromString("rwxr-x---"));
            current = current.getParent();
        }
        return path;
    }

    /**
     * 외부 준비 파일을 객체 재생성 뒤 조회하고 외부 삭제 뒤 503 확인
     */
    @Test
    void externallyPreparedFilesSurviveStorageRecreation() throws Exception {
        var root = directory.resolve("storage");
        privateDirectory(root);
        String key = "ken-blog/attachments/123e4567-e89b-12d3-a456-426614174000.png";
        byte[] bytes = {1, 2, 3};
        privateDirectory(root.resolve(key).getParent());
        Files.write(root.resolve(key), bytes);
        var reopened = new LocalAssetStorage(root.toString());
        try (var stream = reopened.open(key)) {
            assertArrayEquals(bytes, stream.readAllBytes());
        }
        Files.delete(root.resolve(key));
        assertFalse(Files.exists(root.resolve(key)));
        assertEquals(
                HttpStatus.SERVICE_UNAVAILABLE,
                assertThrows(AttachmentFailure.class, () -> reopened.open(key)).getStatus());
    }

    /**
     * 기존 접두사 key를 별도 설정 없이 조회
     */
    @Test
    void existingKeysRemainReadableWithoutPrefixConfiguration() throws Exception {
        var root = directory.resolve("storage");
        String key = "ken-blog/attachments/123e4567-e89b-12d3-a456-426614174000.jpg";
        privateDirectory(root);
        var storage = new LocalAssetStorage(root.toString());
        privateDirectory(root.resolve(key).getParent());
        Files.write(root.resolve(key), new byte[] {4});
        try (var stream = storage.open(key)) {
            assertArrayEquals(new byte[] {4}, stream.readAllBytes());
        }
    }

    /**
     * 상위·절대·역슬래시 경로 접근 거부와 외부 원본 보존
     */
    @Test
    void pathTraversalAndAbsolutePathsCannotReachOutsideFiles() throws Exception {
        privateDirectory(directory.resolve("storage"));
        var storage = new LocalAssetStorage(directory.resolve("storage").toString());
        var outside = directory.resolve("outside.png");
        Files.write(outside, new byte[] {5});
        for (String key :
                List.of(
                        "../outside.png",
                        outside.toString(),
                        "attachments/../../outside.png",
                        "attachments\\outside.png"))
            assertThrows(AttachmentFailure.class, () -> storage.open(key));
        assertArrayEquals(new byte[] {5}, Files.readAllBytes(outside));
    }

    /**
     * 디렉터리·파일 심볼릭 링크 접근 거부와 외부 원본 보존
     */
    @Test
    void symlinkParentsAndFilesCannotExposeOrAlterOutsideFiles() throws Exception {
        assumeTrue(directory.getFileSystem().supportedFileAttributeViews().contains("posix"));
        var root = directory.resolve("storage");
        privateDirectory(root);
        var storage = new LocalAssetStorage(root.toString());
        var outside = directory.resolve("outside");
        privateDirectory(outside);
        String filename = "123e4567-e89b-12d3-a456-426614174000.png";
        Files.write(outside.resolve(filename), new byte[] {7});
        Files.createSymbolicLink(root.resolve("linked"), outside);
        privateDirectory(root.resolve("attachments"));
        Files.createSymbolicLink(
                root.resolve("attachments").resolve(filename), outside.resolve(filename));
        for (String key : List.of("linked/" + filename, "attachments/" + filename))
            assertThrows(AttachmentFailure.class, () -> storage.open(key));
        assertArrayEquals(new byte[] {7}, Files.readAllBytes(outside.resolve(filename)));
    }

    /**
     * 링크인 저장 루트 설정 거부
     */
    @Test
    void aSymlinkStorageRootIsRejected() throws Exception {
        assumeTrue(directory.getFileSystem().supportedFileAttributeViews().contains("posix"));
        var link = directory.resolve("storage");
        Files.createSymbolicLink(link, directory);
        assertThrows(
                AttachmentFailure.class,
                () -> new LocalAssetStorage(link.toString()).requireConfigured());
    }
}
