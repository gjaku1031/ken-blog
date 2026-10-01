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
private fun label(section: String): String = if (section == "PROJECT") "Projects" else "Posts"
private fun postPath(post: Record): String = route("post/${slug(value(post, "slug"))}/")
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
    val context = value(record(item["series"]), "name")
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
    private val allPosts: List<Record> by lazy { list(snapshot["posts"]) }
    private val backlinks: Map<String, List<Record>> by lazy {
        val targets = allPosts.sortedWith(compareBy<Record> { value(it, "publishedAt") }.thenBy { (it["id"] as Number).toLong() }).groupBy { value(it, "title").lowercase(java.util.Locale.ROOT) }
        val result = mutableMapOf<String, MutableList<Record>>()
        for (source in allPosts) for (title in (record(source["rendered"])["wikiTargets"] as? List<*> ?: emptyList<Any>())) {
            val target = targets[text(title).lowercase(java.util.Locale.ROOT)]?.firstOrNull() ?: continue
            if (postPath(target) != postPath(source)) result.getOrPut(postPath(target)) { mutableListOf() }
                .add(mapOf("href" to postPath(source), "title" to value(source, "title"), "section" to label(value(source, "section"))))
        }
        result
    }

    /** 로그인 껍데기와 자산 주소만 렌더링하며 관리자 데이터는 템플릿에 전달하지 않는다. */
    private fun manage() {
        val admin = record(payload["admin"])
        val context = Context(java.util.Locale.KOREAN).apply {
            setVariables(mapOf("apiBase" to value(admin, "apiBase"),
                "adminCss" to value(admin, "css"), "adminJs" to value(admin, "js")))
        }
        val file = output.resolve("manage/index.html")
        Files.createDirectories(file.parent)
        Files.writeString(file, "<!doctype html>\n" + engine.process("manage", context), StandardCharsets.UTF_8)
    }

    /** 공통 헤더·메타 태그와 지정한 본문 fragment를 결합한다. */
    private fun page(path: String, view: String, section: String, title: String, description: String, data: Record = emptyMap(), sitemap: Boolean = true) {
        val canonicalPath = when (path) { "post" -> "posts/"; "project" -> "projects/";
            "404.html" -> "404.html"; "" -> ""; else -> "$path/" }
        val canonical = ORIGIN + route(canonicalPath)
        val documentTitle = when (section) { "Home" -> "ken.blog | Posts·Projects"; "Search" -> "ken.blog"; else -> "$title | ken.blog" }
        val summary = when (section) { "Home" -> "기술 글과 프로젝트, 학습 기록을 모아 둔 ken.blog";
            "Search" -> "일반 글과 프로젝트 기록을 읽는 ken.blog"; else -> description }
        val socialTitle = if (section in setOf("Post", "Project") && path.isNotEmpty()) title else documentTitle
        val active = when (section) { "Post" -> "Posts"; "Project" -> "Projects"; "Search" -> "Home"; else -> section }
        val nav = listOf("" to "Home", "posts/" to "Posts", "projects/" to "Projects")
            .map { (href, label) -> mapOf("href" to route(href), "label" to label, "active" to (label == active)) }
        val model = mapOf("view" to view, "section" to section, "documentTitle" to documentTitle, "socialTitle" to socialTitle,
            "summary" to summary, "canonical" to canonical, "ogType" to if (section in setOf("Post", "Project") && path.isNotEmpty()) "article" else "website",
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
            "cards" to cards, "categories" to categories, "tags" to tags, "searching" to (section == "Search"),
            "groups" to if (section == "Posts") rows.map { record(it["series"]) }.filter { it.isNotEmpty() }
                .distinctBy { value(it, "slug") }.map { mapOf("name" to value(it, "name"), "href" to postPath(list(it["items"]).first())) }
                else emptyList<Record>()))
    }

    /** 공통 글 경로와 첫 공개 글로 향하는 묶음 이동 경로를 생성한다. */
    fun generate() {
        require((snapshot["version"] as? Number)?.toInt() == 2) { "공개 스냅샷 버전 오류" }
        manage()
        val feed = allPosts.sortedWith(compareByDescending<Record> { value(it, "publishedAt") }.thenByDescending { (it["id"] as Number).toLong() })
        val home = feed.take(12)
        val profile = record(snapshot["profile"])
        page("", "home", "Home", "Home", "Ken Blog", mapOf("cards" to home.map(::card), "profile" to profile,
            "hasProfile" to profile.values.any { text(it).isNotEmpty() },
            "profileEmailSafe" to EMAIL.matches(value(profile, "email")),
            "categories" to home.map { value(record(it["category"]), "path") }.filter(String::isNotEmpty).distinct().sorted(),
            "tags" to home.flatMap { (it["tags"] as? List<*>)?.map(::text) ?: emptyList() }.distinct().sorted()))
        listing("posts", "Posts", "Posts", feed.filter { value(it, "section") == "TECH" })
        val groups = list(snapshot["series"])
        val projects = groups.filter { value(it, "kind") == "PROJECT" }
            .sortedWith(compareBy<Record> { (it["sortOrder"] as Number).toLong() }.thenBy { (it["id"] as Number).toLong() })
            .map { it + mapOf("href" to postPath(record(it["cover"])), "statusLabel" to status(it["projectStatus"]),
                "statusClass" to value(it, "projectStatus").lowercase(), "period" to period(it + ("status" to it["projectStatus"]))) }
        page("projects", "projects", "Projects", "Projects", "공개 프로젝트 목록", mapOf("projects" to projects))
        listing("search", "Search", "Search", feed.map { it + ("searchBody" to searchText(value(record(it["rendered"]), "html"))) })
        for (post in allPosts) {
            val navigation = record(post["series"])
            val items = list(navigation["items"]).map { it + mapOf("href" to postPath(it), "current" to (it["id"] == post["id"])) }
            val project = projects.firstOrNull { it["id"] == navigation["id"] && it["slug"] == navigation["slug"] }
            val related = projects.firstOrNull { it["id"] == record(post["relatedSeries"])["id"] }
            page("post/${slug(value(post, "slug"))}", "post", if (value(post, "section") == "PROJECT") "Project" else "Post",
                value(post, "title"), value(post, "summary"),
                mapOf("post" to post + mapOf("displayDate" to date(post["publishedDate"]), "relatedProject" to related),
                    "project" to project, "html" to value(record(post["rendered"]), "html"), "toc" to headings(post),
                    "backlinks" to (backlinks[postPath(post)] ?: emptyList()), "series" to items,
                    "seriesName" to value(navigation, "name"), "seriesPosition" to navigation["position"]))
        }
        // 정확한 옛 주소만 허용하고 공개되지 않은 대상에는 호환 페이지를 만들지 않음.
        val aliases = linkedMapOf("tech" to route("posts/"), "post" to route("posts/"),
            "project" to route("projects/"), "notes" to route("posts/"), "course" to route("posts/"))
        for (group in groups) {
            val target = postPath(record(group["cover"]))
            aliases["series/${slug(value(group, "slug"))}"] = target
            if (value(group, "kind") == "PROJECT") aliases["project/${slug(value(group, "slug"))}"] = target
            else aliases["course/${slug(value(group, "slug"))}"] = target
        }
        for (post in allPosts) {
            val old = value(post, "legacyPath").trim('/')
            if (old.isNotEmpty()) {
                require(Regex("(?:project/[a-z0-9-]+(?:/docs/[a-z0-9-]+)?|course/[a-z0-9-]+/chapters/[a-z0-9-]+)").matches(old))
                // 프로젝트 루트는 현재 첫 글을 계속 가리키도록 유지.
                aliases.putIfAbsent(old, postPath(post))
            }
        }
        for ((path, target) in aliases) redirect(path, target)
        page("404.html", "missing", "", "페이지 없음", "페이지를 찾을 수 없습니다.", sitemap = false)
        Files.writeString(output.resolve("robots.txt"), "User-agent: *\nAllow: /ken-blog/\nSitemap: $ORIGIN${route("sitemap.xml")}\n")
        val sitemap = pages.joinToString("") { "<url><loc>$ORIGIN${route(if (it.isEmpty()) "" else "$it/")}</loc></url>" }
        Files.writeString(output.resolve("sitemap.xml"), "<?xml version=\"1.0\" encoding=\"UTF-8\"?><urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">$sitemap</urlset>")
        Files.writeString(output.resolve("routes.json"), mapper.writeValueAsString(pages.map { if (it.isEmpty()) "" else "$it/" }))
    }

    private fun redirect(path: String, target: String) {
        require(Regex("/ken-blog/(?:posts|projects|post/[a-z0-9-]+)/").matches(target))
        val file = output.resolve(path).resolve("index.html")
        Files.createDirectories(file.parent)
        Files.writeString(file, "<!doctype html><html lang=\"ko\"><head><meta charset=\"utf-8\"><meta http-equiv=\"refresh\" content=\"0;url=$target\"><link rel=\"canonical\" href=\"$ORIGIN$target\"><title>페이지 이동</title></head><body><a href=\"$target\">글로 이동</a></body></html>")
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
