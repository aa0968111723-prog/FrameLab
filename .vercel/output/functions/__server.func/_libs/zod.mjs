import { B as ZodBoolean, V as ZodString, et as _coercedBoolean, tt as _coercedString } from "./@better-auth/core+[...].mjs";
//#region node_modules/zod/v4/classic/coerce.js
function string(params) {
	return _coercedString(ZodString, params);
}
function boolean(params) {
	return _coercedBoolean(ZodBoolean, params);
}
//#endregion
export { string as n, boolean as t };
