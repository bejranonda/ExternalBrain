import type { Translate } from "./api-error";
import { I18N } from "./i18n-dict";

/** Display name for an org role; an unknown role shows as its raw value. */
export function roleLabel(t: Translate, role: string): string {
  return Object.hasOwn(I18N.en.roles, role) ? t(`roles.${role}`) : role;
}
