plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.wefter.bridge"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.wefter.bridge"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "0.0.1"

        // WEFTER-SPLASH-CONFIG-START
        buildConfigField("boolean", "SPLASH_ENABLED", "false")
        buildConfigField("long", "SPLASH_MIN_DURATION_MS", "0L")
        buildConfigField("long", "SPLASH_MAX_DURATION_MS", "5000L")
        buildConfigField("boolean", "SPLASH_WAIT_FOR_READY", "true")
        buildConfigField("boolean", "SPLASH_FADE_TRANSITION", "true")
        // WEFTER-SPLASH-CONFIG-END
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }

    buildFeatures {
        buildConfig = true
    }

    flavorDimensions += "environment"
    productFlavors {
        create("development") {
            dimension = "environment"
            // WEFTER-ENV-CONFIG-START

            // WEFTER-ENV-CONFIG-END
        }
        create("production") {
            dimension = "environment"
            // WEFTER-ENV-CONFIG-START

            // WEFTER-ENV-CONFIG-END
        }
    }

    signingConfigs {
        create("release") {
            val keystorePath = System.getenv("WEFTER_KEYSTORE_PATH")
            if (keystorePath != null) {
                storeFile = file(keystorePath)
                storePassword = System.getenv("WEFTER_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("WEFTER_KEY_ALIAS")
                keyPassword = System.getenv("WEFTER_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            buildConfigField("String", "DEV_SERVER_URL", "\"\"") // overridden per-run by the CLI
        }
        release {
            buildConfigField("String", "DEV_SERVER_URL", "\"\"") // always empty in release — never shippable
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (System.getenv("WEFTER_KEYSTORE_PATH") != null) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("androidx.core:core-splashscreen:1.0.1")

    // WEFTER-PLUGIN-DEPS-START

    // WEFTER-PLUGIN-DEPS-END

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.mockito:mockito-core:5.12.0")
    testImplementation("org.json:json:20240303")
}
