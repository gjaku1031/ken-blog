package io.github.gjaku1031.kenblog

import io.github.gjaku1031.kenblog.mcp.authoring.McpDocumentValidation
import io.github.gjaku1031.kenblog.series.dto.*
import io.github.gjaku1031.kenblog.mcp.dto.McpImageInput
import io.github.gjaku1031.kenblog.mcp.dto.McpPostMetadataInput
import io.github.gjaku1031.kenblog.mcp.dto.McpStackBadgeInput
import io.github.gjaku1031.kenblog.mcp.tool.McpRegisteredPostResult
import io.github.gjaku1031.kenblog.post.dto.*
import io.modelcontextprotocol.spec.McpSchema
import java.lang.reflect.RecordComponent
import org.springframework.aot.hint.BindingReflectionHintsRegistrar
import org.springframework.aot.hint.ExecutableMode
import org.springframework.aot.hint.MemberCategory
import org.springframework.aot.hint.RuntimeHints
import org.springframework.aot.hint.RuntimeHintsRegistrar
import org.springframework.aot.hint.TypeReference
import org.springframework.jdbc.support.SQLErrorCodes
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.security.core.context.SecurityContextImpl
import org.springframework.security.web.csrf.DefaultCsrfToken

/** Native Image에서 동적으로 읽는 MCP 문서와 JDBC 세션 객체의 직렬화 메타데이터를 보존. */
class NativeRuntimeHints : RuntimeHintsRegistrar {
    override fun registerHints(hints: RuntimeHints, classLoader: ClassLoader?) {
        hints.resources().registerPattern("mcp/ken-blog-authoring/**")
        hints.resources().registerPattern("org/springframework/jdbc/support/sql-error-codes.xml")
        hints.resources().registerPattern("META-INF/spring.schemas")
        hints.resources().registerPattern("org/springframework/beans/factory/xml/spring-beans.xsd")
        registerImageIoHints(hints)
        registerJooqHints(hints)

        // Jackson과 Kotlin reflection이 MCP Java record의 구성 요소 접근자를 Method.invoke로 조회한다.
        hints.reflection().registerType(RecordComponent::class.java, MemberCategory.INVOKE_PUBLIC_METHODS)
        // Kotlin reflection의 Java16SealedRecordLoader가 이 네 Class 메서드를 Method.invoke로 호출한다.
        listOf("isSealed", "getPermittedSubclasses", "isRecord", "getRecordComponents").forEach { name ->
            hints.reflection().registerMethod(Class::class.java.getMethod(name), ExecutableMode.INVOKE)
        }

        // JDBC 오류 코드 XML의 Bean은 런타임에 생성되고 setter로 채워진다.
        hints.reflection().registerType(SQLErrorCodes::class.java,
            MemberCategory.INVOKE_PUBLIC_CONSTRUCTORS,
            MemberCategory.INVOKE_PUBLIC_METHODS,
        )

        // Kotlin reflection이 SDK의 중첩 Java record를 찾을 때 선언 클래스의 멤버 목록을 조회한다.
        hints.reflection().registerType(McpSchema::class.java,
            MemberCategory.PUBLIC_CLASSES,
            MemberCategory.DECLARED_CLASSES,
            MemberCategory.PUBLIC_FIELDS,
            MemberCategory.DECLARED_FIELDS,
            MemberCategory.INVOKE_PUBLIC_METHODS,
            MemberCategory.INVOKE_DECLARED_METHODS,
            MemberCategory.INVOKE_PUBLIC_CONSTRUCTORS,
            MemberCategory.INVOKE_DECLARED_CONSTRUCTORS,
        )

        // Spring AI는 도구 메서드만 등록하므로 Jackson 입력·출력 DTO의 바인딩 힌트를 추가한다.
        BindingReflectionHintsRegistrar().registerReflectionHints(hints.reflection(),
            McpPostMetadataInput::class.java,
            McpImageInput::class.java,
            McpStackBadgeInput::class.java,
            SeriesCreateRequest::class.java,
            SeriesMetadataRequest::class.java,
            SeriesResponse::class.java,
            SeriesDetailResponse::class.java,
            McpRegisteredPostResult::class.java,
            McpDocumentValidation::class.java,
            PublicPostSummaryResponse::class.java,
            ContentFeedPage::class.java,
            PostPageResponse::class.java,
            PublicPostDetailResponse::class.java,
        )

        // Jackson의 Kotlin 모듈이 빈 컬렉션 싱글턴을 Kotlin reflection으로 다시 찾는다.
        listOf(emptyList<Any>()::class.java, emptySet<Any>()::class.java,
            emptyMap<Any, Any>()::class.java).forEach { type ->
            hints.reflection().registerType(type)
        }
        // JVM 전체 경로 추적에서 확인된 buildList() 구현체도 Class.forName으로 탐색된다.
        listOf("kotlin.collections.AbstractMutableList",
            "kotlin.collections.builders.ListBuilder",
            "kotlin.collections.builders.ListBuilder\$BuilderSubList",
            "kotlin.collections.builders.ListBuilder\$Companion",
            "kotlin.collections.builders.ListBuilder\$Itr").forEach { type ->
            hints.reflection().registerType(TypeReference.of(type))
        }

        // 로그인 인증·CSRF 토큰은 Spring Session JDBC가 Java 직렬화로 보관한다.
        hints.reflection().registerJavaSerialization(SecurityContextImpl::class.java)
        hints.reflection().registerJavaSerialization(UsernamePasswordAuthenticationToken::class.java)
        hints.reflection().registerJavaSerialization(SimpleGrantedAuthority::class.java)
        hints.reflection().registerJavaSerialization(DefaultCsrfToken::class.java)
    }

    /** jOOQ는 초기화 시 내장 SQL 타입의 배열 클래스와 dialect 클래스를 이름으로 찾는다. */
    private fun registerJooqHints(hints: RuntimeHints) {
        val sqlTypes = org.jooq.impl.SQLDataType::class.java
        hints.reflection().registerType(sqlTypes, MemberCategory.ACCESS_PUBLIC_FIELDS)
        sqlTypes.fields.filter { org.jooq.DataType::class.java.isAssignableFrom(it.type) }.forEach { field ->
            val type = (field.get(null) as org.jooq.DataType<*>).type
            hints.reflection().registerType(type.arrayType())
        }
        Class.forName("org.jooq.impl.SQLDataTypes").declaredClasses.forEach { type ->
            hints.reflection().registerType(type)
        }
    }

    /** JVM 추적 에이전트가 실제 PNG/JPEG 읽기·리사이즈·PNG 쓰기에서 관찰한 JDK JNI 접근. */
    private fun registerImageIoHints(hints: RuntimeHints) {
        fun jniFields(type: String, vararg names: String) {
            hints.jni().registerType(TypeReference.of(type)) { member ->
                names.forEach { member.withField(it) }
            }
        }
        fun jniMethods(type: String, vararg signatures: String) {
            hints.jni().registerType(TypeReference.of(type)) { member ->
                signatures.forEach { signature ->
                    val name = signature.substringBefore('(')
                    val arguments = signature.substringAfter('(').removeSuffix(")")
                    val parameters = if (arguments.isEmpty()) emptyList() else
                        arguments.split(',').map { TypeReference.of(it) }
                    if (name == "<init>") member.withConstructor(parameters, ExecutableMode.INVOKE)
                    else member.withMethod(name, parameters, ExecutableMode.INVOKE)
                }
            }
        }

        jniMethods("com.sun.imageio.plugins.jpeg.JPEGImageReader", "acceptPixels(int,boolean)", "passComplete()", "passStarted(int)", "pushBack(int)", "readInputData(byte[],int,int)", "setImageData(int,int,int,int,int,byte[])", "skipInputBytes(long)", "skipPastImage(int)", "warningOccurred(int)", "warningWithMessage(java.lang.String)")
        jniFields("java.awt.AlphaComposite", "extraAlpha", "rule")
        jniMethods("java.awt.Color", "getRGB()")
        jniMethods("java.awt.GraphicsEnvironment", "isHeadless()")
        jniFields("java.awt.geom.AffineTransform", "m00", "m01", "m02", "m10", "m11", "m12")
        jniFields("java.awt.geom.Path2D", "numTypes", "pointTypes", "windingRule")
        jniFields("java.awt.geom.Path2D\$Float", "floatCoords")
        jniFields("java.awt.image.BufferedImage", "colorModel", "imageType", "raster")
        jniMethods("java.awt.image.BufferedImage", "getRGB(int,int,int,int,int[],int,int)", "setRGB(int,int,int,int,int[],int,int)")
        jniFields("java.awt.image.ColorModel", "colorSpace", "colorSpaceType", "isAlphaPremultiplied", "is_sRGB", "nBits", "numComponents", "supportsAlpha", "transparency")
        jniMethods("java.awt.image.ColorModel", "getRGBdefault()")
        jniFields("java.awt.image.IndexColorModel", "allgrayopaque", "colorData", "map_size", "rgb", "transparent_index")
        jniFields("java.awt.image.Raster", "dataBuffer", "height", "minX", "minY", "numBands", "numDataElements", "sampleModel", "sampleModelTranslateX", "sampleModelTranslateY", "width")
        jniFields("java.awt.image.SampleModel", "height", "width")
        jniMethods("java.awt.image.SampleModel", "getPixels(int,int,int,int,int[],java.awt.image.DataBuffer)", "setPixels(int,int,int,int,int[],java.awt.image.DataBuffer)")
        jniFields("java.awt.image.SinglePixelPackedSampleModel", "bitMasks", "bitOffsets", "bitSizes", "maxBitSize")
        jniMethods("java.lang.Boolean", "getBoolean(java.lang.String)")
        jniMethods("java.lang.System", "load(java.lang.String)")
        jniFields("javax.imageio.plugins.jpeg.JPEGHuffmanTable", "lengths", "values")
        jniFields("javax.imageio.plugins.jpeg.JPEGQTable", "qTable")
        jniFields("sun.awt.SunHints", "INTVAL_STROKE_PURE")
        jniFields("sun.awt.image.BufImgSurfaceData\$ICMColorData", "pData")
        jniMethods("sun.awt.image.BufImgSurfaceData\$ICMColorData", "<init>(long)")
        jniFields("sun.awt.image.ByteComponentRaster", "data", "dataOffsets", "pixelStride", "scanlineStride", "type")
        jniFields("sun.awt.image.IntegerComponentRaster", "data", "dataOffsets", "pixelStride", "scanlineStride", "type")
        jniFields("sun.awt.image.ShortComponentRaster", "data", "dataOffsets", "pixelStride", "scanlineStride", "type")
        jniMethods("sun.java2d.Disposer", "addRecord(java.lang.Object,long,long)")
        hints.jni().registerType(TypeReference.of("sun.java2d.InvalidPipeException"))
        hints.jni().registerType(TypeReference.of("sun.java2d.NullSurfaceData"))
        jniFields("sun.java2d.SunGraphics2D", "clipRegion", "composite", "eargb", "lcdTextContrast", "pixel", "strokeHint")
        jniFields("sun.java2d.SurfaceData", "pData", "valid")
        jniMethods("sun.java2d.loops.Blit", "<init>(long,sun.java2d.loops.SurfaceType,sun.java2d.loops.CompositeType,sun.java2d.loops.SurfaceType)")
        jniMethods("sun.java2d.loops.BlitBg", "<init>(long,sun.java2d.loops.SurfaceType,sun.java2d.loops.CompositeType,sun.java2d.loops.SurfaceType)")
        jniFields("sun.java2d.loops.CompositeType", "AnyAlpha", "Src", "SrcNoEa", "SrcOver", "SrcOverNoEa", "Xor")
        jniMethods("sun.java2d.loops.DrawGlyphList", "<init>(long,sun.java2d.loops.SurfaceType,sun.java2d.loops.CompositeType,sun.java2d.loops.SurfaceType)")
        jniMethods("sun.java2d.loops.DrawGlyphListAA", "<init>(long,sun.java2d.loops.SurfaceType,sun.java2d.loops.CompositeType,sun.java2d.loops.SurfaceType)")
        jniMethods("sun.java2d.loops.DrawGlyphListLCD", "<init>(long,sun.java2d.loops.SurfaceType,sun.java2d.loops.CompositeType,sun.java2d.loops.SurfaceType)")
        jniMethods("sun.java2d.loops.DrawLine", "<init>(long,sun.java2d.loops.SurfaceType,sun.java2d.loops.CompositeType,sun.java2d.loops.SurfaceType)")
        jniMethods("sun.java2d.loops.DrawParallelogram", "<init>(long,sun.java2d.loops.SurfaceType,sun.java2d.loops.CompositeType,sun.java2d.loops.SurfaceType)")
        jniMethods("sun.java2d.loops.DrawPath", "<init>(long,sun.java2d.loops.SurfaceType,sun.java2d.loops.CompositeType,sun.java2d.loops.SurfaceType)")
        jniMethods("sun.java2d.loops.DrawPolygons", "<init>(long,sun.java2d.loops.SurfaceType,sun.java2d.loops.CompositeType,sun.java2d.loops.SurfaceType)")
        jniMethods("sun.java2d.loops.DrawRect", "<init>(long,sun.java2d.loops.SurfaceType,sun.java2d.loops.CompositeType,sun.java2d.loops.SurfaceType)")
        jniMethods("sun.java2d.loops.FillParallelogram", "<init>(long,sun.java2d.loops.SurfaceType,sun.java2d.loops.CompositeType,sun.java2d.loops.SurfaceType)")
        jniMethods("sun.java2d.loops.FillPath", "<init>(long,sun.java2d.loops.SurfaceType,sun.java2d.loops.CompositeType,sun.java2d.loops.SurfaceType)")
        jniMethods("sun.java2d.loops.FillRect", "<init>(long,sun.java2d.loops.SurfaceType,sun.java2d.loops.CompositeType,sun.java2d.loops.SurfaceType)")
        jniMethods("sun.java2d.loops.FillSpans", "<init>(long,sun.java2d.loops.SurfaceType,sun.java2d.loops.CompositeType,sun.java2d.loops.SurfaceType)")
        jniFields("sun.java2d.loops.GraphicsPrimitive", "pNativePrim")
        jniMethods("sun.java2d.loops.GraphicsPrimitiveMgr", "register(sun.java2d.loops.GraphicsPrimitive[])")
        jniMethods("sun.java2d.loops.MaskBlit", "<init>(long,sun.java2d.loops.SurfaceType,sun.java2d.loops.CompositeType,sun.java2d.loops.SurfaceType)")
        jniMethods("sun.java2d.loops.MaskFill", "<init>(long,sun.java2d.loops.SurfaceType,sun.java2d.loops.CompositeType,sun.java2d.loops.SurfaceType)")
        jniMethods("sun.java2d.loops.ScaledBlit", "<init>(long,sun.java2d.loops.SurfaceType,sun.java2d.loops.CompositeType,sun.java2d.loops.SurfaceType)")
        jniFields("sun.java2d.loops.SurfaceType", "Any3Byte", "Any4Byte", "AnyByte", "AnyColor", "AnyInt", "AnyShort", "ByteBinary1Bit", "ByteBinary2Bit", "ByteBinary4Bit", "ByteGray", "ByteIndexed", "ByteIndexedBm", "FourByteAbgr", "FourByteAbgrPre", "Index12Gray", "Index8Gray", "IntArgb", "IntArgbBm", "IntArgbPre", "IntBgr", "IntRgb", "IntRgbx", "OpaqueColor", "ThreeByteBgr", "Ushort4444Argb", "Ushort555Rgb", "Ushort555Rgbx", "Ushort565Rgb", "UshortGray", "UshortIndexed")
        jniMethods("sun.java2d.loops.TransformHelper", "<init>(long,sun.java2d.loops.SurfaceType,sun.java2d.loops.CompositeType,sun.java2d.loops.SurfaceType)")
        jniFields("sun.java2d.loops.XORComposite", "alphaMask", "xorColor", "xorPixel")
        jniFields("sun.java2d.pipe.Region", "bands", "endIndex", "hix", "hiy", "lox", "loy")
        jniFields("sun.java2d.pipe.RegionIterator", "curIndex", "numXbands", "region")

        // JDK ImageIO 서비스 탐색과 AWT의 기본 리소스 번들.
        listOf("ImageInputStreamSpi", "ImageOutputStreamSpi", "ImageReaderSpi",
            "ImageTranscoderSpi", "ImageWriterSpi").forEach { type ->
            hints.resources().registerPattern("META-INF/services/javax.imageio.spi.$type")
        }
        hints.resources().registerResourceBundle("sun.awt.resources.awt")
        listOf("javax.imageio.spi.ImageReaderSpi", "javax.imageio.spi.ImageWriterSpi",
            "sun.java2d.loops.GraphicsPrimitive[]").forEach { type ->
            hints.reflection().registerType(TypeReference.of(type))
        }
        hints.reflection().registerType(TypeReference.of("sun.java2d.marlin.DMarlinRenderingEngine")) {
            it.withConstructor(emptyList(), ExecutableMode.INVOKE)
        }
        hints.reflection().registerType(TypeReference.of("sun.security.provider.NativePRNG")) {
            it.withConstructor(listOf(TypeReference.of("java.security.SecureRandomParameters")), ExecutableMode.INVOKE)
        }
        hints.reflection().registerType(TypeReference.of("sun.security.provider.SHA")) {
            it.withConstructor(emptyList(), ExecutableMode.INVOKE)
        }
    }
}
