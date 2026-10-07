package io.github.gjaku1031.kenblog.attachment.storage;

import io.github.gjaku1031.kenblog.attachment.domain.AttachmentFailure;
import io.github.gjaku1031.kenblog.global.text.Text;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.io.*;
import java.nio.channels.*;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermission;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 영속 로컬 디렉터리의 이미지 읽기; 심볼릭 링크·불안전한 권한 거부
 */
@Component
public final class LocalAssetStorage {
    /**
     * 정규화한 저장 루트, 미설정이면 null
     */
    private final Path root;

    /**
     * 허용 이미지 객체 경로 패턴
     */
    private static final Pattern KEY =
            Pattern.compile(
                    "[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*/[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}\\.(?:jpg|png)");

    /**
     * 빈 설정 허용, 지정 경로는 파일시스템 루트가 아닌 절대경로만 허용
     */
    public LocalAssetStorage(@Value("${app.assets.directory:}") String directory) {
        String value = Text.trim(directory);
        root = value.isEmpty() ? null : Path.of(value).toAbsolutePath().normalize();
        if (!Text.isBlank(directory) && !Path.of(value).isAbsolute())
            throw new IllegalStateException("Asset directory must be absolute");
        if (root != null && root.equals(root.getRoot()))
            throw new IllegalStateException("Asset directory cannot be the filesystem root");
    }

    /**
     * 설정된 저장 루트를 실제 디렉터리로 열 수 있는지 확인
     */
    public void requireConfigured() {
        if (root == null) throw unavailable();
        try {
            ensureDirectory(root);
        } catch (Exception exception) {
            throw unavailable();
        }
    }

    /**
     * 크기 지정 없이 원본 파일 스트림 열기, 호출자가 닫아야 함
     */
    public InputStream open(String key) {
        return open(key, null);
    }

    /**
     * 링크를 따르지 않는 핸들을 연 뒤 기대 크기 확인, 호출자가 스트림을 닫아야 함
     */
    public InputStream open(String key, Long expectedSize) {
        requireConfigured();
        Path path = resolve(key);
        try {
            checkSafePath(path);
            var channel =
                    FileChannel.open(
                            path,
                            Set.<OpenOption>of(StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS));
            try {
                if (expectedSize != null && channel.size() != expectedSize) throw unavailable();
                return Channels.newInputStream(channel);
            } catch (Exception exception) {
                channel.close();
                throw exception;
            }
        } catch (Exception exception) {
            throw unavailable();
        }
    }

    /**
     * 검증된 객체 key의 저장 루트 내부 경로
     */
    private Path resolve(String key) {
        if (root == null || key.length() > 255 || !KEY.matcher(key).matches()) throw unavailable();
        var path = root.resolve(key).normalize();
        if (!path.startsWith(root) || path.equals(root)) throw unavailable();
        return path;
    }

    /**
     * 조상의 링크·권한 검사 후 대상이 일반 파일인지 확인
     */
    private void checkSafePath(Path path) throws IOException {
        Path current = path.getRoot();
        if (current == null || root == null) throw unavailable();
        for (Path part : path) {
            current = current.resolve(part);
            if (Files.isSymbolicLink(current)) throw unavailable();
            if (!current.equals(path)
                    && Files.exists(current, LinkOption.NOFOLLOW_LINKS)
                    && !Files.isDirectory(current, LinkOption.NOFOLLOW_LINKS)) throw unavailable();
            if (!current.equals(path)
                    && current.startsWith(root)
                    && Files.exists(current, LinkOption.NOFOLLOW_LINKS))
                ensurePrivateDirectory(current);
        }
        if (Files.exists(path, LinkOption.NOFOLLOW_LINKS)
                && !Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) throw unavailable();
    }

    /**
     * 경로 각 단계가 준비된 일반 디렉터리인지 검사
     */
    private void ensureDirectory(Path directory) throws IOException {
        Path current = directory.getRoot();
        if (current == null || root == null) throw unavailable();
        for (Path part : directory) {
            current = current.resolve(part);
            if (Files.isSymbolicLink(current)
                    || !Files.isDirectory(current, LinkOption.NOFOLLOW_LINKS)) throw unavailable();
            if (current.startsWith(root)) ensurePrivateDirectory(current);
        }
    }

    /**
     * 저장 루트 아래에서 다른 계정의 이름 변경·링크 삽입 권한 거부
     */
    private void ensurePrivateDirectory(Path directory) throws IOException {
        var permissions = Files.getPosixFilePermissions(directory, LinkOption.NOFOLLOW_LINKS);
        if (permissions.contains(PosixFilePermission.GROUP_WRITE)
                || permissions.contains(PosixFilePermission.OTHERS_WRITE)) throw unavailable();
    }

    /**
     * 저장소 조회 실패 객체 생성
     *
     * @return 경로·I/O 원인을 공개하지 않는 HTTP 503용 예외
     */
    private AttachmentFailure unavailable() {
        return new AttachmentFailure(HttpStatus.SERVICE_UNAVAILABLE, "첨부 저장소를 사용할 수 없습니다.");
    }
}
