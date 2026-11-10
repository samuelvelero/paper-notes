import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// El núcleo: Kotlin puro, sin Android. Markdown ↔ bloques del editor (el
// mismo dialecto que pb_public/js/mdpm.js), los derivados (md.js) y las
// consultas de la lista. Se prueba con casos de oro generados desde la web
// (android/scripts/oro-md.js).
plugins {
    alias(libs.plugins.kotlin.jvm)
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}
kotlin { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }

dependencies {
    testImplementation(libs.kotlinx.serialization.json)
    testImplementation(kotlin("test"))
    testImplementation(libs.junit)
}
