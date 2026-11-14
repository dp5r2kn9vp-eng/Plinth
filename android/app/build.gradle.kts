// Plinth Player für Android (Tablets, Android-TV-Boxen, Signage-Displays mit Android 7+).
// Die Oberfläche ist dieselbe wie beim Windows-Player (player/src/renderer + shared/renderer);
// sie wird beim Bauen in die Assets kopiert und über den lokalen Webserver des Kerns ausgeliefert.
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val appVersion = (findProperty("plinthVersion") as String?) ?: "1.0.0"
val parts = appVersion.split(".").map { it.takeWhile(Char::isDigit).toIntOrNull() ?: 0 } + listOf(0, 0, 0)

android {
    namespace = "de.klangniveau.plinth.player"
    compileSdk = 35

    defaultConfig {
        applicationId = "de.klangniveau.plinth.player"
        minSdk = 24
        targetSdk = 35
        versionName = appVersion
        versionCode = parts[0] * 10000 + parts[1] * 100 + parts[2]
    }

    // Release-Signatur aus Umgebungsvariablen (CI-Secrets). Ohne sie: fester Testschlüssel aus dem Repository
    // (test-signing.keystore, Passwort öffentlich) – nur zum Ausprobieren, damit Updates zwischen Test-Builds klappen.
    val ks = System.getenv("PLINTH_KEYSTORE")
    signingConfigs {
        if (ks != null && file(ks).exists()) {
            create("release") {
                storeFile = file(ks)
                storePassword = System.getenv("PLINTH_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("PLINTH_KEY_ALIAS")
                keyPassword = System.getenv("PLINTH_KEY_PASSWORD")
            }
        }
        create("test") {
            storeFile = file("test-signing.keystore")
            storePassword = "plinth-test"
            keyAlias = "plinth-test"
            keyPassword = "plinth-test"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("test")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/plinth-assets"))

    lint {
        // Kiosk-App: Start nach dem Booten und Vollbild sind gewollt
        disable += setOf("ExportedReceiver")
        abortOnError = true
    }
}

kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }

dependencies {
    // org.json gehört auf Android zur Plattform
    implementation(project(":core")) { exclude(group = "org.json") }
}

// Oberfläche des Windows-Players übernehmen: index.html bekommt eine passende CSP und die Android-Brücke
val copyPlayerUi by tasks.registering(Sync::class) {
    val repo = rootProject.projectDir.parentFile
    into(layout.buildDirectory.dir("generated/plinth-assets/player"))
    from(File(repo, "player/src/renderer")) {
        filesMatching("index.html") {
            filter { line ->
                when {
                    line.contains("Content-Security-Policy") ->
                        """<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self'">"""
                    line.contains("<script type=\"module\" src=\"player.js\">") ->
                        "<script src=\"android-bridge.js\"></script>\n$line"
                    else -> line
                }
            }
        }
    }
    from(File(repo, "shared/renderer")) { into("shared/renderer") }
    from(file("src/main/assets-extra"))
}
tasks.named("preBuild") { dependsOn(copyPlayerUi) }
