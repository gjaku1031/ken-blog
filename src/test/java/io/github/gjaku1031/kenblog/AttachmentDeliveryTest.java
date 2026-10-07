package io.github.gjaku1031.kenblog;

import static org.junit.jupiter.api.Assertions.*;

import io.github.gjaku1031.kenblog.attachment.domain.AttachmentFailure;
import io.github.gjaku1031.kenblog.attachment.dto.AttachmentDeliveryRow;
import io.github.gjaku1031.kenblog.attachment.service.PostAttachmentDeliveryService;
import io.github.gjaku1031.kenblog.attachment.storage.LocalAssetStorage;
import io.github.gjaku1031.kenblog.post.repository.PostQueries;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.Mockito;
import org.springframework.http.HttpStatus;

import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.List;

/**
 * DB 전달 정보와 이미 연 파일의 실제 크기 대조
 */
final class AttachmentDeliveryTest {
    /**
     * 실제 파일 핸들 검사용 임시 루트
     */
    @TempDir Path directory;

    /**
     * 정상 전달 후 잘못된 MIME·길이·실제 파일 크기 불일치 거부
     */
    @Test
    void validatesDeliveryMetadataBeforeHeaders() throws Exception {
        String key = "attachments/123e4567-e89b-12d3-a456-426614174000.png";
        Files.setPosixFilePermissions(directory, PosixFilePermissions.fromString("rwxr-x---"));
        Files.createDirectory(
                directory.resolve("attachments"),
                PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwxr-x---")));
        byte[] bytes = {1, 2, 3};
        Files.write(directory.resolve(key), bytes);
        var queries = Mockito.mock(PostQueries.class);
        var service =
                new PostAttachmentDeliveryService(
                        queries, new LocalAssetStorage(directory.toString()));
        Mockito.when(queries.readableAttachment(1, 1))
                .thenReturn(new AttachmentDeliveryRow(key, "image/png", 3));
        try (var stream = service.open(1, 1).stream()) {
            assertArrayEquals(bytes, stream.readAllBytes());
        }
        for (var invalid :
                List.of(
                        new AttachmentDeliveryRow(key, "text/html", 3),
                        new AttachmentDeliveryRow(key, "image/png", 0),
                        new AttachmentDeliveryRow(key, "image/png", -1),
                        new AttachmentDeliveryRow(key, "image/png", 10_485_761),
                        new AttachmentDeliveryRow(key, "image/png", 4))) {
            Mockito.when(queries.readableAttachment(1, 1)).thenReturn(invalid);
            assertEquals(
                    HttpStatus.SERVICE_UNAVAILABLE,
                    assertThrows(AttachmentFailure.class, () -> service.open(1, 1)).getStatus());
        }
        assertArrayEquals(bytes, Files.readAllBytes(directory.resolve(key)));
    }
}
