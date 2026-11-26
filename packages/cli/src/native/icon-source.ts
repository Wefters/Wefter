import sharp from "sharp";

/** Smallest accepted icon source, in pixels per side. */
export const MIN_ICON_SIZE = 1024;

/**
 * Checks that the icon source image is large enough.
 *
 * @throws {Error} When it is smaller than {@link MIN_ICON_SIZE} on either side.
 */
export async function assertIconSourceSize(source: string): Promise<void> {
  const { width = 0, height = 0 } = await sharp(source).metadata();
  if (width < MIN_ICON_SIZE || height < MIN_ICON_SIZE) {
    throw new Error(
      `Icon source is ${width}x${height}px, but must be at least ${MIN_ICON_SIZE}x${MIN_ICON_SIZE}px: ${source}`,
    );
  }
}
