// Prebuilt sections shown in Add > Prebuilt sections: the real library lives in lib/sites/library.ts.
import { LIBRARY, LIBRARY_CATEGORIES, type LibraryEntry } from "@/lib/sites/library";

export type Prebuilt = LibraryEntry;
export const PREBUILT: Prebuilt[] = LIBRARY;
export const PREBUILT_CATEGORIES = LIBRARY_CATEGORIES;
