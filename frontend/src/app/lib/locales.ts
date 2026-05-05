export type LocaleCode =
    | "ar"
    | "en"
    | "ur"
    | "hi"
    | "tl"
    | "bn"
    | "ne"
    | "ml"
    | "fr"
    | "fa";

export type LocaleEntry = {
    code: LocaleCode;
    nativeName: string;
    englishName: string;
    rtl: boolean;
    purpose: string;
};

export const LOCALES: LocaleEntry[] = [
    {
        code: "ar",
        nativeName: "العربية",
        englishName: "Arabic",
        rtl: true,
        purpose: "Qatari official language; mainland courts; Al Meezan source materials",
    },
    {
        code: "en",
        nativeName: "English",
        englishName: "English",
        rtl: false,
        purpose: "QFC working language; international contracts",
    },
    {
        code: "ur",
        nativeName: "اردو",
        englishName: "Urdu",
        rtl: true,
        purpose: "Pakistani migrant workforce — labour rights, immigration",
    },
    {
        code: "hi",
        nativeName: "हिन्दी",
        englishName: "Hindi",
        rtl: false,
        purpose: "Indian migrant workforce — labour rights, family law",
    },
    {
        code: "tl",
        nativeName: "Tagalog",
        englishName: "Tagalog (Filipino)",
        rtl: false,
        purpose: "Filipino migrant workforce — domestic, hospitality, healthcare",
    },
    {
        code: "bn",
        nativeName: "বাংলা",
        englishName: "Bengali",
        rtl: false,
        purpose: "Bangladeshi migrant workforce — construction, services",
    },
    {
        code: "ne",
        nativeName: "नेपाली",
        englishName: "Nepali",
        rtl: false,
        purpose: "Nepali migrant workforce — construction, security",
    },
    {
        code: "ml",
        nativeName: "മലയാളം",
        englishName: "Malayalam",
        rtl: false,
        purpose: "Kerala migrant workforce — professional and skilled trades",
    },
    {
        code: "fr",
        nativeName: "Français",
        englishName: "French",
        rtl: false,
        purpose: "Maghrebi expatriate community",
    },
    {
        code: "fa",
        nativeName: "فارسی",
        englishName: "Persian",
        rtl: true,
        purpose: "Iranian community in Qatar",
    },
];

export const DEFAULT_LOCALE: LocaleCode = "en";

export const RTL_LOCALES: ReadonlySet<LocaleCode> = new Set(
    LOCALES.filter((l) => l.rtl).map((l) => l.code),
);

export function isRTL(code: LocaleCode): boolean {
    return RTL_LOCALES.has(code);
}

export function getLocale(code: string): LocaleEntry | undefined {
    return LOCALES.find((l) => l.code === code);
}
