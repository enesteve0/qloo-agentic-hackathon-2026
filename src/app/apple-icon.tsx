import { plateMark } from './plate-mark';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/** Home-screen icon (square; the platform applies its own mask). */
export default function AppleIcon() {
  return plateMark(size.width);
}
