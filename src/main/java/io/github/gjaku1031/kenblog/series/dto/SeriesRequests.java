package io.github.gjaku1031.kenblog.series.dto;

import io.github.gjaku1031.kenblog.global.text.Text;
import io.github.gjaku1031.kenblog.series.domain.*;

import tools.jackson.databind.JsonNode;

import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.util.*;
import java.util.regex.Pattern;

/**
 * 시리즈 JSON 타입·문자열·기간·종류별 메타데이터 검사
 */
public final class SeriesRequests {
    /**
     * 연월 입력 패턴
     */
    private static final Pattern PERIOD = Pattern.compile("[0-9]{4}\\.(0[1-9]|1[0-2])");

    /**
     * 정적 입력 검증 전용
     */
    private SeriesRequests() {}

    /**
     * 허용 키·프로젝트 상태·기술 목록·수정 시각 검사
     */
    public static SeriesMetadataRequest metadata(JsonNode node) {
        var allowed =
                Set.of(
                        "name",
                        "description",
                        "projectStatus",
                        "startPeriod",
                        "endPeriod",
                        "stackBadgeNames",
                        "baseUpdatedAt");
        if (!node.isObject()
                || node.properties().stream().anyMatch(entry -> !allowed.contains(entry.getKey())))
            throw new InvalidSeriesRequestException();
        String statusText = optionalText(node, "projectStatus");
        ProjectStatus status = null;
        if (statusText != null) {
            try {
                status = ProjectStatus.valueOf(statusText);
            } catch (IllegalArgumentException exception) {
                throw new InvalidSeriesRequestException();
            }
        }
        // 기술 이름은 문자열 배열만 허용
        var badges = new ArrayList<String>();
        var values = node.get("stackBadgeNames");
        if (values != null) {
            if (!values.isArray() || values.size() > 30) throw new InvalidSeriesRequestException();
            for (JsonNode value : values) {
                if (!value.isString()) throw new InvalidSeriesRequestException();
                badges.add(value.stringValue());
            }
        }
        // 선택 수정 시각을 강제 변환 없이 파싱
        String baseText = optionalText(node, "baseUpdatedAt");
        LocalDateTime base = null;
        if (baseText != null) {
            try {
                base = LocalDateTime.parse(baseText);
            } catch (DateTimeParseException exception) {
                throw new InvalidSeriesRequestException();
            }
        }
        String name = optionalText(node, "name");
        if (name == null) throw new InvalidSeriesRequestException();
        String description = optionalText(node, "description");
        return new SeriesMetadataRequest(
                name,
                description == null ? "" : description,
                status,
                optionalText(node, "startPeriod"),
                optionalText(node, "endPeriod"),
                badges,
                base);
    }

    /**
     * 허용 생성 키·종류·필수 메타데이터 검사 후 입력 구성
     */
    public static SeriesCreateRequest create(JsonNode node) {
        var allowed = Set.of("slug", "kind", "metadata");
        if (!node.isObject()
                || node.properties().stream().anyMatch(entry -> !allowed.contains(entry.getKey()))
                || !node.path("kind").isString()
                || !node.has("metadata")) throw new InvalidSeriesRequestException();
        SeriesKind kind;
        try {
            kind = SeriesKind.valueOf(node.get("kind").stringValue());
        } catch (IllegalArgumentException exception) {
            throw new InvalidSeriesRequestException();
        }
        return new SeriesCreateRequest(
                optionalText(node, "slug"), kind, metadata(node.get("metadata")));
    }

    /**
     * 공백·길이·제어 문자와 종류별 프로젝트 상태·기간 계약 검사
     */
    public static SeriesMetadataRequest validate(SeriesKind kind, SeriesMetadataRequest input) {
        String name = Text.trim(input.name());
        String description = Text.trim(input.description());
        if (Text.isBlank(name)
                || name.codePointCount(0, name.length()) > 200
                || description.codePointCount(0, description.length()) > 1000
                || name.chars().anyMatch(Character::isISOControl)
                || description
                        .chars()
                        .anyMatch(
                                value ->
                                        Character.isISOControl(value)
                                                && value != '\n'
                                                && value != '\t'))
            throw new InvalidSeriesRequestException();
        // TECH은 프로젝트 전용 값을 거부하고 PROJECT는 상태·유효 기간 필수
        if (kind == SeriesKind.TECH) {
            if (input.projectStatus() != null
                    || input.startPeriod() != null
                    || input.endPeriod() != null
                    || !input.stackBadgeNames().isEmpty())
                throw new InvalidSeriesRequestException();
        } else {
            String start = input.startPeriod();
            String end = input.endPeriod();
            if (start == null
                    || input.projectStatus() == null
                    || !PERIOD.matcher(start).matches()
                    || start.startsWith("0000")
                    || end != null
                            && (!PERIOD.matcher(end).matches()
                                    || end.startsWith("0000")
                                    || end.compareTo(start) < 0))
                throw new InvalidSeriesRequestException();
        }
        return new SeriesMetadataRequest(
                name,
                description,
                input.projectStatus(),
                input.startPeriod(),
                input.endPeriod(),
                input.stackBadgeNames(),
                input.baseUpdatedAt());
    }

    /**
     * 선택 문자열의 null·타입 검사
     */
    private static String optionalText(JsonNode node, String name) {
        var value = node.get(name);
        if (value == null || value.isNull()) return null;
        if (!value.isString()) throw new InvalidSeriesRequestException();
        return value.stringValue();
    }
}
