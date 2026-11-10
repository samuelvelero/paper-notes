// Paper Notes para Android. Kotlin + Compose (solo `foundation`: la interfaz
// se dibuja a mano con los tokens de la web, sin la librería de Material).
// Kotlin viene integrado en AGP 9: no se aplica kotlin-android.
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// El número de la beta (scripts/publicar-beta.sh lo pasa como -PpaperBuild=N,
// con N = número de commits). Sube el versionCode, que es lo que Android
// exige para instalar ENCIMA, y entra en el versionName, de donde Obtainium
// saca la versión. Sin él, 0: un build local cualquiera.
val build = providers.gradleProperty("paperBuild").orNull?.toInt() ?: 0

// La llave de release NO vive en el repo. Si algún día se publica fuera de
// Obtainium, se lee de ~/.gradle/gradle.properties (PAPER_KEYSTORE, …).
val keystore = providers.gradleProperty("PAPER_KEYSTORE").orNull

// Solo para PROBAR la beta (R8) contra el PocketBase local del emulador:
// -PpaperLocal deja pasar http y propone 10.0.2.2. Nunca se publica así
// (publicar-beta.sh no lo pasa).
val local = providers.gradleProperty("paperLocal").isPresent

// El servidor que la pantalla de entrada trae ya escrito. Vacío en el APK
// público (cada quien pone el suyo); quien publica para sí mismo lo pasa con
// -PpaperServidor=https://… (publicar-beta.sh lo lee de publicar.env).
val servidor = providers.gradleProperty("paperServidor").orNull ?: ""

android {
    namespace = "com.samukis.papernotes"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.samukis.papernotes"
        minSdk = 26
        targetSdk = 36
        // 200: al pasar a main (0.1.1) el número de commits bajó; la beta 0.1.0
        // llegó a 127 y lo nuevo tiene que instalarse encima.
        versionCode = 200 + build
        versionName = "0.1.1"
        // El servidor que propone la pantalla de entrada (se puede cambiar ahí).
        buildConfigField("String", "SERVIDOR", "\"$servidor\"")
        // http solo en depuración: la beta y el release hablan https.
        manifestPlaceholders["cleartext"] = "false"
    }

    signingConfigs {
        if (keystore != null) create("release") {
            storeFile = file(keystore)
            storePassword = providers.gradleProperty("PAPER_KEYSTORE_PASSWORD").get()
            keyAlias = providers.gradleProperty("PAPER_KEY_ALIAS").get()
            keyPassword = providers.gradleProperty("PAPER_KEY_PASSWORD").get()
        }
    }

    buildTypes {
        debug {
            // Convive con la beta: es la de desarrollo, habla por http con el
            // PocketBase local y no pasa por R8.
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            buildConfigField("String", "SERVIDOR", "\"http://10.0.2.2:8796\"")
            manifestPlaceholders["cleartext"] = "true"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (keystore != null) signingConfig = signingConfigs.getByName("release")
        }
        // La beta de Obtainium: el release de verdad (R8, no depurable, con el
        // Baseline Profile de Compose) firmado con la llave de depuración de
        // este PC. Un APK depurable no llega a 120/144 Hz: ART lo corre sin
        // optimizar.
        create("beta") {
            initWith(getByName("release"))
            versionNameSuffix = "-beta.$build"
            signingConfig = signingConfigs.getByName("debug")
            matchingFallbacks += listOf("release")
            if (local) {
                buildConfigField("String", "SERVIDOR", "\"http://10.0.2.2:8796\"")
                manifestPlaceholders["cleartext"] = "true"
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures { compose = true; buildConfig = true }
}

dependencies {
    implementation(project(":core"))

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.activity.compose)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)
    // Volver a primer plano = sincronizar.
    implementation(libs.lifecycle.process)
    implementation(libs.lifecycle.runtime.compose)
    // Instala los perfiles de arranque (los de Compose vienen en la librería).
    implementation(libs.profileinstaller)
}
