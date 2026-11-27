package dev.wefter.bridge

import androidx.core.content.FileProvider

/**
 * Shares the app's camera captures with the camera app (see `res/xml/wefter_file_paths.xml`). A subclass of
 * its own, so a plugin declaring `FileProvider` for its own files does not clash with it in the manifest.
 */
class WefterFileProvider : FileProvider()
