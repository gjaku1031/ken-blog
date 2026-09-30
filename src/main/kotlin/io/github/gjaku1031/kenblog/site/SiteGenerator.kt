package io.github.gjaku1031.kenblog.site

import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.time.Year
import java.time.ZoneOffset
import org.thymeleaf.context.Context
import org.thymeleaf.spring6.SpringTemplateEngine
import org.thymeleaf.templatemode.TemplateMode
import org.thymeleaf.templateresolver.ClassLoaderTemplateResolver
import tools.jackson.databind.ObjectMapper

private const val BASE = "/ken-blog/"
private const val ORIGIN = "https://gjaku1031.github.io"
private val SLUG = Regex("[a-z0-9]+(?:-[a-z0-9]+)*")
private val EMAIL = Regex("[^\\s@<>\"'/?#]+@[^\\s@<>\"'/?#]+\\.[A-Za-z]{2,}")
private typealias Record = Map<String, Any?>

/** 빌드용 JSON의 map 구조를 원형으로 읽되 템플릿 입력에서 값을 검사한다. */
private fun record(value: Any?): Record = (value as? Map<*, *>)?.entries?.associate { (key, item) ->
    (key as? String ?: error("공개 스냅샷 키 형식 오류")) to item
} ?: emptyMap()
private fun list(value: Any?): List<Record> = (value as? List<*>)?.map(::record) ?: emptyList()
private fun text(value: Any?): String = value?.toString() ?: ""
private fun value(row: Record, key: String): String = text(row[key])
private fun slug(value: String): String { require(SLUG.matches(value)) { "공개 slug 형식 오류" }; return value }
private fun route(path: String = ""): String = BASE + path
private fun date(value: Any?): String = text(value).take(10).replace('-', '.')
private fun searchText(html: String): String {
    val named = mapOf("amp" to "&", "lt" to "<", "gt" to ">", "quot" to "\"", "apos" to "'", "nbsp" to " ")
    return html.replace(Regex("<[^>]*>"), " ").replace(Regex("&(#(?:x[0-9a-f]+|[0-9]+)|[a-z]+);", RegexOption.IGNORE_CASE)) { match ->
        val code = match.groupValues[1].lowercase()
        if (!code.startsWith("#")) named[code] ?: match.value else {
            val number = if (code.startsWith("#x")) code.drop(2).toIntOrNull(16) else code.drop(1).toIntOrNull()
            if (number != null && number in 32..0x10ffff && number !in 0xd800..0xdfff) String(Character.toChars(number)) else " "
        }
    }.replace(Regex("\\s+"), " ").trim()
}
private fun label(section: String): String = when (section) { "TECH" -> "Tech"; "NOTE_CHAPTER" -> "Notes"; else -> "Projects" }
private fun postPath(post: Record): String = when (value(post, "section")) {
    "PROJECT_HOME" -> route("project/${slug(value(post, "projectSlug"))}/")
    "PROJECT_DOC" -> route("project/${slug(value(post, "projectSlug"))}/docs/${slug(value(post, "slug"))}/")
    "NOTE_CHAPTER" -> route("course/${slug(value(post, "courseSlug"))}/chapters/${slug(value(post, "slug"))}/")
    else -> route("post/${slug(value(post, "slug"))}/")
}
private fun status(value: Any?): String = when (text(value)) { "PLAN" -> "기획 중"; "DEV" -> "개발 중"; "MAINT" -> "유지보수 중"; "DONE" -> "완료"; else -> text(value) }
private fun period(project: Record): String {
    val start = value(project, "startPeriod"); val end = value(project, "endPeriod")
    return when { start.isEmpty() -> end; end.isEmpty() -> if (value(project, "status") == "DONE") start else "$start – 현재";
        start == end -> start; else -> "$start – $end" }
}
private fun enriched(row: Record, extra: Record = emptyMap()): Record = row + extra
private fun card(item: Record): Record {
    val category = value(record(item["category"]), "path")
    val tags = (item["tags"] as? List<*>)?.map(::text) ?: emptyList()
    val context = if (value(item, "section") == "NOTE_CHAPTER")
        listOf(value(item, "courseField"), value(item, "courseName")).filter(String::isNotEmpty).joinToString(" › ")
        else value(item, "projectName")
    val title = value(item, "title").ifEmpty { value(item, "name").ifEmpty { "제목 없음" } }
    val summary = value(item, "summary").ifEmpty { value(item, "overview").ifEmpty { value(item, "description") } }
    return item + mapOf("href" to postPath(item), "title" to title, "summary" to summary, "categoryPath" to category,
        "tags" to tags, "tagText" to tags.joinToString("|"), "label" to label(value(item, "section")), "context" to context,
        "searchText" to "$title $summary $category ${tags.joinToString(" ")} $context ${value(item, "searchBody")}",
        "displayDate" to date(item["publishedDate"] ?: item["latestPublishedDate"]))
}
private fun headings(post: Record): List<Record> = list(record(post["rendered"])["headings"])
    .filter { it["depth"] == 2 || it["depth"] == 3 }

/** DB를 열지 않고 준비된 공개 스냅샷을 Thymeleaf 정적 HTML로 만든다. */
class SiteGenerator(private val input: Path, private val output: Path) {
    private val mapper = ObjectMapper()
    private val engine = SpringTemplateEngine().apply {
        setTemplateResolver(ClassLoaderTemplateResolver().apply {
            setPrefix("templates/site/"); setSuffix(".html"); setCharacterEncoding("UTF-8")
            setTemplateMode(TemplateMode.HTML); setCacheable(true)
        })
    }
    private val payload: Record = record(mapper.readValue(Files.readString(input), Map::class.java))
    private val snapshot = record(payload["snapshot"])
    private val assets = record(payload["assets"])
    private val pages = mutableListOf<String>()
    private val allPosts: List<Record> by lazy {
        list(snapshot["posts"]) + list(snapshot["projects"]).map { project ->
            record(record(record(snapshot["projectDetails"])[value(project, "slug")])["home"]) +
                mapOf("section" to "PROJECT_HOME", "projectSlug" to value(project, "slug"), "title" to value(project, "name"))
        } + record(snapshot["projectDocuments"]).values.flatMap { record(it).values.map(::record) } +
            record(snapshot["chapters"]).values.flatMap { record(it).values.map(::record) }
    }
    private val backlinks: Map<String, List<Record>> by lazy {
        val targets = allPosts.groupBy { value(it, "title").lowercase() }.filterValues { it.size == 1 }
        val result = mutableMapOf<String, MutableList<Record>>()
        for (source in allPosts) for (title in (record(source["rendered"])["wikiTargets"] as? List<*> ?: emptyList<Any>())) {
            val target = targets[text(title).lowercase()]?.singleOrNull() ?: continue
            if (postPath(target) != postPath(source)) result.getOrPut(postPath(target)) { mutableListOf() }
                .add(mapOf("href" to postPath(source), "title" to value(source, "title"), "section" to label(value(source, "section"))))
        }
        result
    }

    /** 공통 헤더·메타 태그와 지정한 본문 fragment를 결합한다. */
    private fun page(path: String, view: String, section: String, title: String, description: String, data: Record = emptyMap(), sitemap: Boolean = true) {
        val canonicalPath = when (path) { "post" -> "tech/"; "project" -> "projects/"; "course" -> "notes/";
            "404.html" -> "404.html"; "" -> ""; else -> "$path/" }
        val canonical = ORIGIN + route(canonicalPath)
        val documentTitle = when (section) { "Home" -> "ken.blog | Tech·Projects·Notes"; "Search" -> "ken.blog"; else -> "$title | ken.blog" }
        val summary = when (section) { "Home" -> "기술 글과 프로젝트, 학습 기록을 모아 둔 ken.blog";
            "Search" -> "Tech 글과 프로젝트 기록을 읽는 ken.blog"; else -> description }
        val socialTitle = if (section in setOf("Post", "Project", "Course") && path.isNotEmpty()) title else documentTitle
        val active = when (section) { "Post" -> "Tech"; "Project" -> "Projects"; "Course" -> "Notes"; "Search" -> "Home"; else -> section }
        val nav = listOf("" to "Home", "tech/" to "Tech", "projects/" to "Projects", "notes/" to "Notes")
            .map { (href, label) -> mapOf("href" to route(href), "label" to label, "active" to (label == active)) }
        val model = mapOf("view" to view, "section" to section, "documentTitle" to documentTitle, "socialTitle" to socialTitle,
            "summary" to summary, "canonical" to canonical, "ogType" to if (section in setOf("Post", "Project", "Course") && path.isNotEmpty()) "article" else "website",
            "base" to BASE, "assetsCss" to route("assets/${value(assets, "css")}"), "assetsJs" to route("assets/${value(assets, "js")}"),
            "adminHref" to value(payload, "adminHref"), "nav" to nav, "year" to Year.now(ZoneOffset.UTC).value,
            "github" to "https://github.com/gjaku1031/ken-blog") + data
        val context = Context(java.util.Locale.KOREAN).apply { setVariables(model) }
        val file = if (path == "404.html") output.resolve(path) else output.resolve(path).resolve("index.html")
        Files.createDirectories(file.parent)
        Files.writeString(file, "<!doctype html>\n" + engine.process("page", context), StandardCharsets.UTF_8)
        if (sitemap) pages += path
    }

    /** 목록 카드의 분류·태그 목록도 현재 보이는 항목에서 계산한다. */
    private fun listing(path: String, section: String, title: String, rows: List<Record>) {
        val cards = rows.map(::card)
        val categories = cards.map { value(it, "categoryPath") }.filter(String::isNotEmpty).distinct().sorted()
        val tags = cards.flatMap { (it["tags"] as? List<*>)?.map(::text) ?: emptyList() }.distinct().sorted()
        page(path, "listing", section, title, "$title 공개 글 목록", mapOf("heading" to if (section == "Search") "최근 글" else title,
            "cards" to cards, "categories" to categories, "tags" to tags, "searching" to (section == "Search")))
    }

    /** 필요한 공개 경로를 모두 생성하고 sitemap·robots를 기록한다. */
    fun generate() {
        require((snapshot["version"] as? Number)?.toInt() == 1) { "공개 스냅샷 버전 오류" }
        val feed = list(snapshot["feed"])
        val home = feed.sortedByDescending { value(it, "publishedDate") }.take(12)
        val profile = record(snapshot["profile"])
        page("", "home", "Home", "Home", "Ken Blog", mapOf("cards" to home.map(::card), "profile" to profile,
            "hasProfile" to profile.values.any { text(it).isNotEmpty() },
            "profileEmailSafe" to EMAIL.matches(value(profile, "email")),
            "categories" to home.map { value(record(it["category"]), "path") }.filter(String::isNotEmpty).distinct().sorted(),
            "tags" to home.flatMap { (it["tags"] as? List<*>)?.map(::text) ?: emptyList() }.distinct().sorted()))
        val tech = feed.filter { value(it, "section") == "TECH" }.sortedByDescending { value(it, "publishedDate") }
        listing("tech", "Tech", "Tech", tech)
        listing("post", "Post", "Tech", tech)
        val projects = list(snapshot["projects"]).sortedWith(compareBy<Record> { (it["sortOrder"] as? Number)?.toLong() ?: 0L }.thenByDescending { (it["id"] as? Number)?.toLong() ?: 0L })
            .map { it + mapOf("href" to route("project/${slug(value(it, "slug"))}/"), "statusLabel" to status(it["status"]),
                "statusClass" to value(it, "status").lowercase(), "period" to period(it),
                "relatedTechText" to if ((it["relatedTechCount"] as? Number)?.toInt()?.let { count -> count > 0 } == true)
                    " · 관련 글 ${it["relatedTechCount"]}개" else "") }
        page("projects", "projects", "Projects", "Projects", "Projects 공개 프로젝트 목록", mapOf("projects" to projects))
        page("project", "projects", "Project", "Projects", "Projects 공개 프로젝트 목록", mapOf("projects" to projects), false)
        val notes = list(snapshot["notes"])
        val groups = notes.groupBy { value(it, "field").ifEmpty { "기타" } }.map { (field, courses) ->
            mapOf("field" to field, "courses" to courses.map { it + mapOf("href" to route("course/${slug(value(it, "slug"))}/"),
                "statusLabel" to if (value(it, "status") == "COMPLETED") "완결" else "진행 중", "displayDate" to date(it["latestPublishedDate"])) }) }
        page("notes", "notes", "Notes", "Notes", "Notes 공개 과목 목록", mapOf("groups" to groups, "hasNotes" to notes.isNotEmpty()))
        page("course", "notes", "Course", "Notes", "Notes 공개 과목 목록", mapOf("groups" to groups, "hasNotes" to notes.isNotEmpty()), false)
        val feedById = feed.associateBy { text(it["id"]) }
        val projectBySlug = projects.associateBy { value(it, "slug") }
        val courseBySlug = notes.associateBy { value(it, "slug") }
        val searchRows = allPosts.map { post ->
            val project = projectBySlug[value(post, "projectSlug")] ?: emptyMap()
            val course = courseBySlug[value(post, "courseSlug")] ?: emptyMap()
            val bodyText = searchText(value(record(post["rendered"]), "html"))
            enriched(feedById[text(post["id"])] ?: emptyMap(), post + mapOf("title" to if (value(post, "section") == "PROJECT_HOME") value(project, "name") else value(post, "title"),
                "projectName" to value(project, "name"), "courseName" to value(course, "name"), "courseField" to value(course, "field"), "searchBody" to bodyText))
        }.sortedByDescending { value(it, "publishedDate") }
        listing("search", "Search", "Search", searchRows)
        for (post in list(snapshot["posts"])) {
            val rendered = record(post["rendered"])
            val series = list(record(post["series"])["items"]).sortedBy { (it["order"] as? Number)?.toInt() ?: 0 }
                .map { it + mapOf("href" to route("post/${slug(value(it, "slug"))}/"), "current" to (it["id"] == post["id"])) }
            page("post/${slug(value(post, "slug"))}", "post", "Post", value(post, "title"), value(post, "summary").ifEmpty { value(post, "title") },
                mapOf("post" to post + mapOf("displayDate" to date(post["publishedDate"])), "html" to value(rendered, "html"),
                    "toc" to headings(post), "backlinks" to (backlinks[postPath(post)] ?: emptyList()), "series" to series,
                    "seriesPosition" to (series.indexOfFirst { it["current"] == true } + 1)))
        }
        for (project in projects) {
            val projectSlug = value(project, "slug")
            val detail = record(record(snapshot["projectDetails"])[projectSlug]); val docsBySlug = record(record(snapshot["projectDocuments"])[projectSlug])
            val docs = list(detail["documents"]).filter { doc -> record(docsBySlug[value(doc, "slug")])["id"] == doc["id"] && doc["locked"] != true && doc["visibility"] != "PRIVATE" }
                .sortedBy { (it["order"] as? Number)?.toInt() ?: 0 }.mapIndexed { index, doc -> doc + mapOf("href" to route("project/$projectSlug/docs/${value(doc, "slug")}/"), "number" to index + 1) }
            val related = (list(snapshot["posts"]).filter { value(record(it["relatedProject"]), "slug") == projectSlug } + list(detail["relatedTech"]))
                .distinctBy { value(it, "slug") }.map { mapOf("href" to route("post/${slug(value(it, "slug"))}/"), "title" to value(it, "title")) }
            val home = record(detail["home"]) + mapOf("section" to "PROJECT_HOME", "projectSlug" to projectSlug, "title" to value(project, "name"))
            projectPage("project/$projectSlug", project, home, docs, related, true)
            for (doc in docsBySlug.values.map(::record)) projectPage("project/$projectSlug/docs/${value(doc, "slug")}", project, doc, docs, related, false)
        }
        for (course in notes) {
            val courseSlug = value(course, "slug"); val detail = record(record(snapshot["courseDetails"])[courseSlug]); val bySlug = record(record(snapshot["chapters"])[courseSlug])
            val chapters = list(detail["chapters"]).filter { chapter -> record(bySlug[value(chapter, "slug")])["id"] == chapter["id"] && chapter["locked"] != true && chapter["visibility"] != "PRIVATE" }
                .sortedBy { (it["position"] as? Number)?.toInt() ?: 0 }.mapIndexed { index, item -> item + mapOf("href" to route("course/$courseSlug/chapters/${value(item, "slug")}/"),
                    "number" to index + 1, "displayNumber" to (index + 1).toString().padStart(2, '0'), "displayDate" to date(item["publishedDate"])) }
            coursePage("course/$courseSlug", course, null, chapters)
            for (post in bySlug.values.map(::record)) coursePage("course/$courseSlug/chapters/${value(post, "slug")}", course, post, chapters)
        }
        page("404.html", "missing", "", "페이지 없음", "페이지를 찾을 수 없습니다.", sitemap = false)
        Files.writeString(output.resolve("robots.txt"), "User-agent: *\nAllow: /ken-blog/\nSitemap: $ORIGIN${route("sitemap.xml")}\n")
        val publishedPages = pages.filterNot { it == "post" || it == "project" || it == "course" }
        val sitemap = publishedPages.joinToString("") { "<url><loc>$ORIGIN${route(if (it.isEmpty()) "" else "$it/")}</loc></url>" }
        Files.writeString(output.resolve("sitemap.xml"), "<?xml version=\"1.0\" encoding=\"UTF-8\"?><urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">$sitemap</urlset>")
        val paths = publishedPages.map { if (it.isEmpty()) "" else "$it/" }
        Files.writeString(output.resolve("routes.json"), mapper.writeValueAsString(paths))
    }

    /** 프로젝트 대문과 문서를 동일한 공개 탐색 틀에 넣는다. */
    private fun projectPage(path: String, project: Record, post: Record, docs: List<Record>, related: List<Record>, home: Boolean) {
        val index = docs.indexOfFirst { value(it, "slug") == value(post, "slug") }
        page(path, "project", "Project", value(post, "title"), if (home) value(project, "overview") else value(post, "summary"),
            mapOf("project" to project, "post" to post + mapOf("displayDate" to date(post["publishedDate"])), "docs" to docs,
                "related" to related, "home" to home, "html" to value(record(post["rendered"]), "html"), "toc" to if (home) emptyList<Record>() else headings(post),
                "backlinks" to (backlinks[postPath(post)] ?: emptyList()), "previous" to docs.getOrNull(index - 1), "next" to docs.getOrNull(index + 1)))
    }

    /** 과목 소개와 회차 문서를 같은 정적 경로 규칙으로 생성한다. */
    private fun coursePage(path: String, course: Record, post: Record?, chapters: List<Record>) {
        val index = chapters.indexOfFirst { value(it, "slug") == post?.let { row -> value(row, "slug") } }
        page(path, "course", "Course", post?.let { value(it, "title") } ?: value(course, "name"),
            post?.let { value(it, "summary") } ?: value(course, "description"),
            mapOf("course" to course, "post" to post, "chapters" to chapters, "chapterPosition" to index + 1,
                "html" to post?.let { value(record(it["rendered"]), "html") }, "toc" to post?.let(::headings),
                "backlinks" to (post?.let { backlinks[postPath(it)] } ?: emptyList()), "previous" to chapters.getOrNull(index - 1), "next" to chapters.getOrNull(index + 1),
                "courseStatus" to if (value(course, "status") == "COMPLETED") "완결" else "진행 중"))
    }
}

/** 컴파일된 클래스와 런타임 의존성을 classpath로 받아 실행되는 독립 CLI 진입점. */
fun main(args: Array<String>) {
    val options = args.filter { it.startsWith("--") && it.contains('=') }.associate { it.substringBefore('=') to it.substringAfter('=') }
    val input = options["--input"]?.let(Path::of) ?: error("--input 경로가 필요합니다.")
    val output = options["--output"]?.let(Path::of) ?: error("--output 경로가 필요합니다.")
    require(Files.isRegularFile(input)) { "공개 스냅샷 입력이 없습니다: $input" }
    require(Files.isDirectory(output)) { "Pages 출력 디렉터리가 없습니다: $output" }
    SiteGenerator(input, output).generate()
}
