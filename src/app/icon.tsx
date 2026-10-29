import { plateMark } from './plate-mark';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

/** Browser tab icon. */
export default function Icon() {
  return plateMark(size.width, { rounded: true });
}
