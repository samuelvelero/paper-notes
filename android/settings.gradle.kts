pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories { google(); mavenCentral() }
}
rootProject.name = "PaperNotes"

include(":core")   // Kotlin puro: Markdown ↔ bloques, derivados, consultas. Se prueba sin Android.
include(":app")    // Android: datos (SQLite + PocketBase), Compose, widgets, tiles
