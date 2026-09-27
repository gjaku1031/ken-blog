package io.github.gjaku1031.kenblog.project.dto

import io.github.gjaku1031.kenblog.post.domain.PostVisibility
import io.github.gjaku1031.kenblog.project.domain.InvalidProjectRequestException
import io.github.gjaku1031.kenblog.project.domain.ProjectMetadata
import io.github.gjaku1031.kenblog.project.domain.ProjectStatus
import java.time.LocalDateTime
import java.time.format.DateTimeParseException
import tools.jackson.databind.JsonNode

/** 프로젝트 기간·개요·상태의 엄격 JSON 입력과 같은 규칙의 출간 검증. */
object ProjectMetadataRequests {
    /** @return 필수 HOME 메타데이터와 기존 프로젝트의 기준 수정 시각. */
    fun parse(node: JsonNode?, visibility: PostVisibility): ProjectMetadata {
        if (node == null || !node.isObject) throw InvalidProjectRequestException()
        val status = when (string(node, "status")) {
            "PLAN" -> ProjectStatus.PLAN
            "DEV" -> ProjectStatus.DEV
            "MAINT" -> ProjectStatus.MAINT
            "DONE" -> ProjectStatus.DONE
            else -> throw InvalidProjectRequestException()
        }
        val start = string(node, "startPeriod")
        val end = node.get("endPeriod")?.let {
            if (it.isNull) null else if (it.isTextual) it.textValue() else throw InvalidProjectRequestException()
        }?.ifEmpty { null }
        val overview = string(node, "overview")
        val declaredVisibility = when (string(node, "visibility")) {
            "PUBLIC" -> PostVisibility.PUBLIC
            "PRIVATE" -> PostVisibility.PRIVATE
            else -> throw InvalidProjectRequestException()
        }
        if (declaredVisibility != visibility) throw InvalidProjectRequestException()
        val base = node.get("baseProjectUpdatedAt")?.let {
            if (it.isNull) null else if (it.isTextual) try { LocalDateTime.parse(it.textValue()) }
            catch (ex: DateTimeParseException) { throw InvalidProjectRequestException() }
            else throw InvalidProjectRequestException()
        }
        val badgesNode = node.get("stackBadgeNames")
        val badges = if (badgesNode == null || badgesNode.isNull) emptyList() else {
            if (!badgesNode.isArray || badgesNode.size() > 30) throw InvalidProjectRequestException()
            (0 until badgesNode.size()).map { index ->
                val item = badgesNode.get(index)
                if (!item.isTextual || item.textValue().isBlank() || item.textValue().length > 100 ||
                    item.textValue().any(Character::isISOControl)) throw InvalidProjectRequestException()
                item.textValue().trim()
            }
        }
        return validate(ProjectMetadata(status, start, end, overview, visibility, base, badges))
    }

    /** @return 입력 기간을 `YYYY.MM`으로 정규화하고 순서·개요를 검증한 [ProjectMetadata]. */
    fun validate(value: ProjectMetadata): ProjectMetadata {
        val normalized = value.copy(startPeriod = normalizePeriod(value.startPeriod),
            endPeriod = value.endPeriod?.takeUnless(String::isBlank)?.let(::normalizePeriod))
        if ((normalized.startPeriod.isNotEmpty() && normalized.endPeriod != null &&
                periodKey(normalized.endPeriod, upper = true) < periodKey(normalized.startPeriod, upper = false)) ||
            value.overview.codePointCount(0, value.overview.length) > 500 ||
            value.overview.any { Character.isISOControl(it) && it != '\n' } ||
            value.stackBadgeNames.size > 30 || value.stackBadgeNames.distinct().size != value.stackBadgeNames.size)
            throw InvalidProjectRequestException()
        return normalized
    }

    /** @return 연도나 `YYYY.M`·`YYYY/MM`·`YYYY-MM`을 저장용 `YYYY.MM`으로 바꾼 기간. */
    private fun normalizePeriod(raw: String): String {
        val value = raw.trim()
        if (value.isEmpty()) return value
        val parts = INPUT_PERIOD.matchEntire(value) ?: throw InvalidProjectRequestException()
        val month = parts.groupValues[2]
        if (month.isEmpty()) return parts.groupValues[1]
        val number = month.toInt()
        if (number !in 1..12) throw InvalidProjectRequestException()
        return "${parts.groupValues[1]}.${number.toString().padStart(2, '0')}"
    }

    /** @return 누락·숫자 입력을 거부한 필수 문자열. */
    private fun string(node: JsonNode, name: String): String = node.get(name)?.let {
        if (!it.isTextual) throw InvalidProjectRequestException()
        it.textValue()
    } ?: throw InvalidProjectRequestException()

    /** @return 시작의 연도는 1월, 끝의 연도는 12월로 확장한 월 비교 키. */
    private fun periodKey(value: String, upper: Boolean): Int = value.take(4).toInt() * 12 +
        (value.substringAfter('.', if (upper) "12" else "01").toInt() - 1)

    private val INPUT_PERIOD = Regex("([0-9]{4})(?:[./-]([0-9]{1,2}))?")
}
