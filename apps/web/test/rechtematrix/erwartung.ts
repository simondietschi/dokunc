/**
 * Rechtematrix: wer darf welche Server Action und welchen Route-Handler
 * aufrufen, und mit welchem Ausgang.
 *
 * Jede Action und jede Route der App hat hier genau einen Eintrag. Der
 * Meta-Test (vollstaendig.test.ts) vergleicht die Schlüssel mit dem
 * Inventar aus dem Quelltext und schlägt bei jeder neuen Action ohne
 * Eintrag an. Geprüfte Einträge fährt der tabellengetriebene
 * Integrationstest (test/integration/rechtematrix.test.ts) gegen die
 * echte Datenbank: je Szenario und Akteur ein Fall.
 *
 * Nur Daten und Typen. Die Einträge stehen nach Schlüssel sortiert; wer
 * einen Eintrag von "offen" auf "geprueft" umstellt, streicht ihn auch
 * aus OFFEN_BESTAND.
 */

/** Wer handelt. Die Space-Rollen gelten im Test-Space der Matrix. */
export const AKTEURE = [
  /** requireUser leitet nach /login um, getCurrentUser gibt null. */
  "abgemeldet",
  /** Angemeldet, kein Mitglied des Space, kein Instanz-Admin. */
  "fremd",
  /** Instanz-Admin ohne Mitgliedschaft: kein Inhaltszugriff. */
  "instanzAdmin",
  /** VIEWER, auf jeder geschützten Seite der Fälle freigegeben. */
  "VIEWER",
  /** MEMBER ohne Freigabe auf geschützten Seiten. */
  "MEMBER",
  /** MEMBER mit Freigabe auf den geschützten Seiten der Fälle. */
  "MEMBER_FREIGABE",
  "ADMIN",
  "OWNER",
] as const;
export type Akteur = (typeof AKTEURE)[number];

/**
 * Ausgang eines Falls: "erlaubt", wenn die Aktion gewirkt hat;
 * "bestaetigung", wenn der Server stattdessen eine Rückfrage mit Token
 * geliefert hat; sonst "abgelehnt".
 */
export type Ausgang = "erlaubt" | "abgelehnt" | "bestaetigung";

/** Sprechende Kennungen der Lücken, die die Matrix sichtbar macht. */
export const LUECKEN_KENNUNGEN = [
  "schutz-kopie",
  "schutz-vorlage",
  "schutz-zug",
  "schutz-papierkorb",
  "loeschen-verwaltung",
  "reauth-bremse",
] as const;
export type LueckenKennung = (typeof LUECKEN_KENNUNGEN)[number];

/**
 * Eine Zelle: der erwartete Ausgang, oder eine Lückenzelle. Eine
 * Lückenzelle erwartet ausdrücklich den heutigen Ausgang, damit ein
 * Absturz nicht als erwarteter Fehlschlag durchgeht. `heute` weicht von
 * `erwartet` ab, mit einer Ausnahme: sind beide "erlaubt", liegt die
 * Lücke in der Wirkung, und die Invariante des Szenarios muss heute
 * scheitern. Wer die Lücke schliesst, macht den Fall damit rot und
 * entfernt den Marker.
 */
export type Zelle =
  | Ausgang
  | { erwartet: Ausgang; heute: Ausgang; luecke: LueckenKennung };

/** Prüfungen nach "erlaubt": hält der Schutz? Umsetzung im Treiber. */
export const INVARIANTEN_NAMEN = [
  "kopieGeschuetzt",
  "kopieOffen",
  "vorlageFreigegeben",
  "wiederhergestellt",
  "zugBestaetigt",
  "zugInSchutz",
  "titelAktuell",
] as const;
export type InvariantenName = (typeof INVARIANTEN_NAMEN)[number];

export type Szenario = {
  akteure: Partial<Record<Akteur, Zelle>>;
  invariante?: InvariantenName;
};

export type Eintrag =
  | { stand: "geprueft"; szenarien: Record<string, Szenario> }
  /** Nur für Schlüssel aus OFFEN_BESTAND. */
  | { stand: "offen"; grund: string }
  /** Abgedeckt in eigenen Tests; jede Datei nennt die Action bzw. Route. */
  | { stand: "extern"; tests: readonly string[]; grund: string }
  /** Nur Routen, bewusst ohne Anmeldung erreichbar. */
  | { stand: "oeffentlich"; grund: string };

const OFFEN = { stand: "offen", grund: "noch ohne Fälle" } as const;

/**
 * Passwortbestätigung am eigenen Konto (Passwort ändern, Konto löschen,
 * Zwei-Faktor aus, neue Codes). Keine Space-Rolle entscheidet hier:
 * MEMBER steht für Person 1, MEMBER_FREIGABE für eine zweite, jeweils
 * frisch angelegt, damit die Bremse je Konto sichtbar wird. Im zweiten
 * Szenario hat Person 1 an den drei anderen Stellen zehnmal ein falsches
 * Passwort eingegeben (aus einer zweiten Sitzung, die dabei endet); ihre
 * Bestätigung mit dem richtigen Passwort ist gebremst, die der zweiten
 * Person nicht.
 */
const PASSWORT_BESTAETIGEN: Eintrag = {
  stand: "geprueft",
  szenarien: {
    "richtiges Passwort": {
      akteure: { abgemeldet: "abgelehnt", MEMBER: "erlaubt", MEMBER_FREIGABE: "erlaubt" },
    },
    "richtiges Passwort nach 10 Fehlversuchen an den anderen Stellen": {
      akteure: { abgemeldet: "abgelehnt", MEMBER: "abgelehnt", MEMBER_FREIGABE: "erlaubt" },
    },
  },
};

/** Von aussen: abgemeldet, fremd und Instanz-Admin ohne Mitgliedschaft. */
const AUSSEN_ABGELEHNT = {
  abgemeldet: "abgelehnt",
  fremd: "abgelehnt",
  instanzAdmin: "abgelehnt",
} as const;

export const ERWARTUNG: Record<string, Eintrag> = {
  "action:app/(auth)/actions.ts#completeTotpLoginAction": {
    stand: "extern",
    tests: ["apps/web/test/integration/passwortweg.test.ts"],
    grund:
      "Anmeldung ohne Space-Rolle: kein zweiter Schritt nach dem Passwort für Konten mit SSO-Bindung, auch wenn sie erst nach dem ersten Schritt gebunden wurden",
  },
  "action:app/(auth)/actions.ts#loginAction": {
    stand: "extern",
    tests: ["apps/web/test/integration/passwortweg.test.ts"],
    grund:
      "Anmeldung ohne Space-Rolle: Passwortweg für Konten mit SSO-Bindung und den Schalter SSO_ENFORCEMENT",
  },
  "action:app/(auth)/actions.ts#registerAction": {
    stand: "extern",
    tests: [
      "apps/web/test/integration/ersteinrichtung.test.ts",
      "apps/web/test/integration/laengen.test.ts",
    ],
    grund:
      "Anmeldung ohne Space-Rolle: erstes Konto nur mit Einrichtungs-Token (Passwort und SSO), danach nur mit Einladung",
  },
  "action:app/(auth)/reset/actions.ts#performResetAction": {
    stand: "extern",
    tests: ["apps/web/test/integration/passwortweg.test.ts"],
    grund:
      "Anmeldung ohne Space-Rolle: Einlösen nur für aktive Konten ohne SSO-Bindung",
  },
  "action:app/(auth)/reset/actions.ts#requestResetAction": {
    stand: "extern",
    tests: ["apps/web/test/integration/reset-request.test.ts"],
    grund:
      "Anmeldung ohne Space-Rolle: kein Reset-Link für Konten mit SSO-Bindung und deaktivierte Konten, gleiche Antwort für alle",
  },
  "action:app/account/actions.ts#changePasswordAction": PASSWORT_BESTAETIGEN,
  "action:app/account/actions.ts#deleteAccountAction": PASSWORT_BESTAETIGEN,
  "action:app/account/actions.ts#logoutEverywhereAction": {
    stand: "extern",
    tests: ["apps/web/test/integration/sitzungsende.test.ts"],
    grund:
      "Nur die eigenen Sitzungen: widerruft alle Sitzungen der angemeldeten Person und keine andere",
  },
  "action:app/account/actions.ts#revokeSessionAction": {
    stand: "extern",
    tests: ["apps/web/test/integration/sitzungsende.test.ts"],
    grund:
      "Nur eigene Sitzungen: die Sitzung einer anderen Person bleibt, die eigene endet mit sitzungBeendet",
  },
  "action:app/account/actions.ts#updateNotificationPrefsAction": OFFEN,
  "action:app/account/actions.ts#updateProfileAction": OFFEN,
  "action:app/account/totp-actions.ts#cancelTotpSetupAction": OFFEN,
  "action:app/account/totp-actions.ts#confirmRecoveryCodesAction": OFFEN,
  "action:app/account/totp-actions.ts#confirmTotpAction": OFFEN,
  "action:app/account/totp-actions.ts#disableTotpAction": PASSWORT_BESTAETIGEN,
  "action:app/account/totp-actions.ts#discardRecoveryCodesAction": OFFEN,
  "action:app/account/totp-actions.ts#regenerateRecoveryCodesAction": PASSWORT_BESTAETIGEN,
  "action:app/account/totp-actions.ts#startTotpSetupAction": OFFEN,
  "action:app/admin/actions.ts#deleteSpaceAction": OFFEN,
  "action:app/admin/actions.ts#deleteUserAction": OFFEN,
  "action:app/admin/actions.ts#resetUserTotpAction": OFFEN,
  "action:app/admin/actions.ts#toggleUserActiveAction": OFFEN,
  "action:app/admin/actions.ts#toggleUserAdminAction": OFFEN,
  "action:app/admin/groups/actions.ts#addGroupMemberAction": OFFEN,
  "action:app/admin/groups/actions.ts#createGroupAction": OFFEN,
  "action:app/admin/groups/actions.ts#deleteGroupAction": {
    stand: "geprueft",
    szenarien: {
      "Gruppe mit Space-Rolle und Seitenfreigabe": {
        akteure: {
          abgemeldet: "abgelehnt",
          fremd: "abgelehnt",
          instanzAdmin: "erlaubt",
          VIEWER: "abgelehnt",
          MEMBER: "abgelehnt",
          MEMBER_FREIGABE: "abgelehnt",
          ADMIN: "abgelehnt",
          OWNER: "abgelehnt",
        },
      },
    },
  },
  "action:app/admin/groups/actions.ts#removeGroupMemberAction": OFFEN,
  "action:app/admin/groups/actions.ts#renameGroupAction": OFFEN,
  "action:app/ask/actions.ts#askAction": OFFEN,
  "action:app/notifications/actions.ts#markAllReadAction": OFFEN,
  "action:app/s/[slug]/actions.ts#addPageGrantAction": OFFEN,
  "action:app/s/[slug]/actions.ts#createPageAction": {
    stand: "geprueft",
    szenarien: {
      "unter offener Seite": {
        akteure: {
          ...AUSSEN_ABGELEHNT,
          VIEWER: "abgelehnt",
          MEMBER: "erlaubt",
          MEMBER_FREIGABE: "erlaubt",
          ADMIN: "erlaubt",
          OWNER: "erlaubt",
        },
      },
      // Die Oberfläche ruft die Action nie mit templateId auf. Die Seite
      // entsteht, aber ohne Inhalt der Vorlage; wo er doch ankommt, muss
      // sie geschützt sein wie die Vorlage.
      "mit templateId einer geschützten Vorlage": {
        invariante: "kopieGeschuetzt",
        akteure: {
          ...AUSSEN_ABGELEHNT,
          VIEWER: "abgelehnt",
          MEMBER: "erlaubt",
          MEMBER_FREIGABE: "erlaubt",
          ADMIN: "erlaubt",
          OWNER: "erlaubt",
        },
      },
    },
  },
  "action:app/s/[slug]/actions.ts#createShareAction": OFFEN,
  "action:app/s/[slug]/actions.ts#deletePageAction": OFFEN,
  "action:app/s/[slug]/actions.ts#purgePageAction": {
    stand: "geprueft",
    szenarien: {
      "offene Seite im Papierkorb": {
        akteure: {
          ...AUSSEN_ABGELEHNT,
          VIEWER: "abgelehnt",
          MEMBER: "abgelehnt",
          MEMBER_FREIGABE: "abgelehnt",
          ADMIN: "erlaubt",
          OWNER: "erlaubt",
        },
      },
      "geschützte Seite im Papierkorb": {
        akteure: {
          ...AUSSEN_ABGELEHNT,
          VIEWER: "abgelehnt",
          MEMBER: "abgelehnt",
          MEMBER_FREIGABE: "abgelehnt",
          ADMIN: "erlaubt",
          OWNER: "erlaubt",
        },
      },
    },
  },
  "action:app/s/[slug]/actions.ts#removePageGrantAction": OFFEN,
  "action:app/s/[slug]/actions.ts#renamePageAction": OFFEN,
  "action:app/s/[slug]/actions.ts#restorePageAction": {
    stand: "geprueft",
    szenarien: {
      "offene Seite im Papierkorb": {
        akteure: {
          ...AUSSEN_ABGELEHNT,
          VIEWER: "abgelehnt",
          MEMBER: "erlaubt",
          MEMBER_FREIGABE: "erlaubt",
          ADMIN: "erlaubt",
          OWNER: "erlaubt",
        },
      },
      "Unterseite, geschützte Elternseite bleibt im Papierkorb": {
        invariante: "wiederhergestellt",
        akteure: {
          ...AUSSEN_ABGELEHNT,
          VIEWER: "abgelehnt",
          MEMBER: "abgelehnt",
          MEMBER_FREIGABE: "erlaubt",
          ADMIN: "erlaubt",
          OWNER: "erlaubt",
        },
      },
    },
  },
  "action:app/s/[slug]/actions.ts#restoreVersionAction": OFFEN,
  "action:app/s/[slug]/actions.ts#revokeShareAction": OFFEN,
  "action:app/s/[slug]/actions.ts#setPageCoverAction": OFFEN,
  "action:app/s/[slug]/actions.ts#setPageIconAction": OFFEN,
  "action:app/s/[slug]/actions.ts#togglePageRestrictionAction": OFFEN,
  "action:app/s/[slug]/favorite-actions.ts#removeFavoriteAction": OFFEN,
  "action:app/s/[slug]/favorite-actions.ts#toggleFavoriteAction": OFFEN,
  "action:app/s/[slug]/members/actions.ts#acceptInvitationAction": OFFEN,
  "action:app/s/[slug]/members/actions.ts#addSpaceGroupAction": OFFEN,
  "action:app/s/[slug]/members/actions.ts#changeRoleAction": OFFEN,
  "action:app/s/[slug]/members/actions.ts#inviteMemberAction": OFFEN,
  "action:app/s/[slug]/members/actions.ts#removeMemberAction": OFFEN,
  "action:app/s/[slug]/members/actions.ts#removeSpaceGroupAction": OFFEN,
  "action:app/s/[slug]/members/actions.ts#revokeInvitationAction": OFFEN,
  "action:app/s/[slug]/members/actions.ts#updateSpaceGroupRoleAction": OFFEN,
  "action:app/s/[slug]/move-actions.ts#movePageAction": {
    stand: "geprueft",
    szenarien: {
      "offene Seite unter offene Seite": {
        akteure: {
          ...AUSSEN_ABGELEHNT,
          VIEWER: "abgelehnt",
          MEMBER: "erlaubt",
          MEMBER_FREIGABE: "erlaubt",
          ADMIN: "erlaubt",
          OWNER: "erlaubt",
        },
      },
      "aus geschütztem Ast an die oberste Ebene": {
        akteure: {
          ...AUSSEN_ABGELEHNT,
          VIEWER: "abgelehnt",
          MEMBER: "abgelehnt",
          MEMBER_FREIGABE: "abgelehnt",
          ADMIN: "bestaetigung",
          OWNER: "bestaetigung",
        },
      },
      "aus geschütztem Ast an die oberste Ebene, bestätigt": {
        invariante: "zugBestaetigt",
        akteure: {
          ...AUSSEN_ABGELEHNT,
          VIEWER: "abgelehnt",
          MEMBER: "abgelehnt",
          MEMBER_FREIGABE: "abgelehnt",
          ADMIN: "erlaubt",
          OWNER: "erlaubt",
        },
      },
      "von einer Schutzwurzel unter eine andere": {
        akteure: {
          ...AUSSEN_ABGELEHNT,
          VIEWER: "abgelehnt",
          MEMBER: "abgelehnt",
          MEMBER_FREIGABE: "abgelehnt",
          ADMIN: "bestaetigung",
          OWNER: "bestaetigung",
        },
      },
      "offene Seite in geschützten Ast": {
        invariante: "zugInSchutz",
        akteure: {
          ...AUSSEN_ABGELEHNT,
          VIEWER: "abgelehnt",
          MEMBER: "abgelehnt",
          MEMBER_FREIGABE: "erlaubt",
          ADMIN: "erlaubt",
          OWNER: "erlaubt",
        },
      },
      "geschützte Wurzel an die oberste Ebene": {
        akteure: {
          ...AUSSEN_ABGELEHNT,
          VIEWER: "abgelehnt",
          MEMBER: "abgelehnt",
          MEMBER_FREIGABE: "erlaubt",
          ADMIN: "erlaubt",
          OWNER: "erlaubt",
        },
      },
    },
  },
  "action:app/s/[slug]/p/[pageId]/comments/actions.ts#createThreadAction": OFFEN,
  "action:app/s/[slug]/p/[pageId]/comments/actions.ts#deleteCommentAction": OFFEN,
  "action:app/s/[slug]/p/[pageId]/comments/actions.ts#editCommentAction": OFFEN,
  "action:app/s/[slug]/p/[pageId]/comments/actions.ts#replyAction": OFFEN,
  "action:app/s/[slug]/p/[pageId]/comments/actions.ts#resolveThreadAction": OFFEN,
  "action:app/s/[slug]/p/[pageId]/comments/actions.ts#toggleSubscriptionAction": OFFEN,
  "action:app/s/[slug]/settings/actions.ts#deleteSpaceAction": OFFEN,
  "action:app/s/[slug]/settings/actions.ts#leaveSpaceAction": OFFEN,
  "action:app/s/[slug]/settings/actions.ts#updateSpaceAction": OFFEN,
  "action:app/s/[slug]/template-actions.ts#createFromTemplateAction": {
    stand: "geprueft",
    szenarien: {
      "offene Vorlage": {
        invariante: "kopieOffen",
        akteure: {
          ...AUSSEN_ABGELEHNT,
          VIEWER: "abgelehnt",
          MEMBER: "erlaubt",
          MEMBER_FREIGABE: "erlaubt",
          ADMIN: "erlaubt",
          OWNER: "erlaubt",
        },
      },
      "geschützte Vorlage": {
        invariante: "kopieGeschuetzt",
        akteure: {
          ...AUSSEN_ABGELEHNT,
          VIEWER: "abgelehnt",
          MEMBER: "abgelehnt",
          MEMBER_FREIGABE: "erlaubt",
          ADMIN: "erlaubt",
          OWNER: "erlaubt",
        },
      },
    },
  },
  "action:app/s/[slug]/template-actions.ts#createTemplateAction": OFFEN,
  "action:app/s/[slug]/template-actions.ts#deleteTemplateAction": OFFEN,
  "action:app/s/[slug]/template-actions.ts#duplicatePageAction": {
    stand: "geprueft",
    szenarien: {
      "offene Seite": {
        invariante: "kopieOffen",
        akteure: {
          ...AUSSEN_ABGELEHNT,
          VIEWER: "abgelehnt",
          MEMBER: "erlaubt",
          MEMBER_FREIGABE: "erlaubt",
          ADMIN: "erlaubt",
          OWNER: "erlaubt",
        },
      },
      "offene Seite unter geschützter Elternseite": {
        invariante: "kopieOffen",
        akteure: {
          ...AUSSEN_ABGELEHNT,
          VIEWER: "abgelehnt",
          MEMBER: "abgelehnt",
          MEMBER_FREIGABE: "erlaubt",
          ADMIN: "erlaubt",
          OWNER: "erlaubt",
        },
      },
      "geschützte Seite auf oberster Ebene": {
        invariante: "kopieGeschuetzt",
        akteure: {
          ...AUSSEN_ABGELEHNT,
          VIEWER: "abgelehnt",
          MEMBER: "abgelehnt",
          MEMBER_FREIGABE: "erlaubt",
          ADMIN: "erlaubt",
          OWNER: "erlaubt",
        },
      },
      "offene Seite mit geschützter Unterseite": {
        invariante: "kopieGeschuetzt",
        akteure: {
          ...AUSSEN_ABGELEHNT,
          VIEWER: "abgelehnt",
          MEMBER: "erlaubt",
          MEMBER_FREIGABE: "erlaubt",
          ADMIN: "erlaubt",
          OWNER: "erlaubt",
        },
      },
    },
  },
  "action:app/s/[slug]/template-actions.ts#importBuiltinTemplateAction": OFFEN,
  "action:app/s/[slug]/template-actions.ts#saveAsTemplateAction": {
    stand: "geprueft",
    szenarien: {
      "offene Seite": {
        akteure: {
          ...AUSSEN_ABGELEHNT,
          VIEWER: "abgelehnt",
          MEMBER: "erlaubt",
          MEMBER_FREIGABE: "erlaubt",
          ADMIN: "erlaubt",
          OWNER: "erlaubt",
        },
      },
      "geschützte Seite": {
        akteure: {
          ...AUSSEN_ABGELEHNT,
          VIEWER: "abgelehnt",
          MEMBER: "abgelehnt",
          MEMBER_FREIGABE: "abgelehnt",
          ADMIN: "bestaetigung",
          OWNER: "bestaetigung",
        },
      },
      "geschützte Seite, bestätigt": {
        invariante: "vorlageFreigegeben",
        akteure: {
          ...AUSSEN_ABGELEHNT,
          VIEWER: "abgelehnt",
          MEMBER: "abgelehnt",
          MEMBER_FREIGABE: "abgelehnt",
          ADMIN: "erlaubt",
          OWNER: "erlaubt",
        },
      },
    },
  },
  "action:app/spaces/actions.ts#createSpaceAction": OFFEN,
  "action:app/spaces/actions.ts#joinSpaceAction": OFFEN,
  "route:app/(auth)/logout/route.ts#POST": {
    stand: "extern",
    tests: ["apps/web/src/app/(auth)/logout/route.test.ts", "e2e/local-copies.spec.ts"],
    grund:
      "Abmelden ohne Space-Rolle: nur von der eigenen Herkunft, beendet nur die Sitzung dieses Geräts",
  },
  "route:app/(auth)/session-ended/route.ts#GET": {
    stand: "oeffentlich",
    grund:
      "Schliesst eine beendete Sitzung im Browser ab; mit gültiger Sitzung nur eine Weiterleitung, ohne Sitzung löscht sie nur Daten dieses Browsers",
  },
  "route:app/api/account/export/route.ts#GET": OFFEN,
  "route:app/api/ai/assist/route.ts#POST": OFFEN,
  "route:app/api/auth/oidc/callback/route.ts#GET": {
    stand: "extern",
    tests: [
      "e2e/sso.spec.ts",
      "apps/web/test/integration/ersteinrichtung.test.ts",
      "apps/web/test/integration/passwortweg.test.ts",
    ],
    grund:
      "Anmeldung ohne Space-Rolle: Rücksprung des Anbieters mit Anmeldung, Verknüpfung, Kontoanlage und falschem state gegen den Test-IdP; erstes Konto nur mit Einrichtungs-Token; zweiter Faktor nach SSO",
  },
  "route:app/api/auth/oidc/start/route.ts#GET": {
    stand: "extern",
    tests: ["e2e/sso.spec.ts"],
    grund:
      "Anmeldung ohne Space-Rolle: Einstieg in die SSO-Anmeldung gegen den Test-IdP",
  },
  "route:app/api/collab/ticket/route.ts#POST": {
    stand: "extern",
    tests: [
      "apps/web/test/integration/collab-ticket-codes.test.ts",
      "apps/web/test/integration/restore-epoch.test.ts",
    ],
    grund:
      "Ticket für den Collab-Server: ohne Sitzung, ohne Rolle im Space, auf geschützten Seiten ohne Freigabe und für Seiten im Papierkorb abgelehnt, jeweils mit dem Code, an dem der Editor die lokale Kopie verwirft",
  },
  "route:app/api/favorites/route.ts#GET": OFFEN,
  "route:app/api/files/[name]/route.ts#GET": OFFEN,
  "route:app/api/health/route.ts#GET": OFFEN,
  "route:app/api/notifications/stream/route.ts#GET": OFFEN,
  "route:app/api/pages/[id]/export/route.ts#GET": OFFEN,
  // "erlaubt" heisst: die Antwort nennt den aktuellen Titel des Ziels;
  // "abgelehnt": 401 oder null statt eines Titels.
  "route:app/api/pages/titles/route.ts#GET": {
    stand: "geprueft",
    szenarien: {
      "offene Zielseite": {
        invariante: "titelAktuell",
        akteure: {
          ...AUSSEN_ABGELEHNT,
          VIEWER: "erlaubt",
          MEMBER: "erlaubt",
          MEMBER_FREIGABE: "erlaubt",
          ADMIN: "erlaubt",
          OWNER: "erlaubt",
        },
      },
      "geschützte Zielseite": {
        invariante: "titelAktuell",
        akteure: {
          ...AUSSEN_ABGELEHNT,
          VIEWER: "erlaubt",
          MEMBER: "abgelehnt",
          MEMBER_FREIGABE: "erlaubt",
          ADMIN: "erlaubt",
          OWNER: "erlaubt",
        },
      },
    },
  },
  "route:app/api/search/route.ts#GET": OFFEN,
  "route:app/api/share/[id]/files/[name]/route.ts#GET": OFFEN,
  "route:app/api/spaces/[id]/import/route.ts#POST": OFFEN,
  "route:app/api/spaces/[id]/pages/route.ts#GET": OFFEN,
  "route:app/api/spaces/[id]/suggest/route.ts#GET": OFFEN,
  "route:app/api/upload/route.ts#POST": OFFEN,
  "route:app/notifications/[id]/route.ts#GET": OFFEN,
  "route:app/p/[pageId]/print/route.ts#GET": OFFEN,
};

/**
 * Eingefroren mit dem Grundgerüst: nur diese Einträge dürfen noch
 * "offen" sein. Eine neue Action braucht Fälle (oder einen Eintrag
 * "extern"/"oeffentlich"); wer einen Eintrag prüft, streicht ihn hier.
 */
export const OFFEN_BESTAND: readonly string[] = [
  "action:app/account/actions.ts#updateNotificationPrefsAction",
  "action:app/account/actions.ts#updateProfileAction",
  "action:app/account/totp-actions.ts#cancelTotpSetupAction",
  "action:app/account/totp-actions.ts#confirmRecoveryCodesAction",
  "action:app/account/totp-actions.ts#confirmTotpAction",
  "action:app/account/totp-actions.ts#discardRecoveryCodesAction",
  "action:app/account/totp-actions.ts#startTotpSetupAction",
  "action:app/admin/actions.ts#deleteSpaceAction",
  "action:app/admin/actions.ts#deleteUserAction",
  "action:app/admin/actions.ts#resetUserTotpAction",
  "action:app/admin/actions.ts#toggleUserActiveAction",
  "action:app/admin/actions.ts#toggleUserAdminAction",
  "action:app/admin/groups/actions.ts#addGroupMemberAction",
  "action:app/admin/groups/actions.ts#createGroupAction",
  "action:app/admin/groups/actions.ts#removeGroupMemberAction",
  "action:app/admin/groups/actions.ts#renameGroupAction",
  "action:app/ask/actions.ts#askAction",
  "action:app/notifications/actions.ts#markAllReadAction",
  "action:app/s/[slug]/actions.ts#addPageGrantAction",
  "action:app/s/[slug]/actions.ts#createShareAction",
  "action:app/s/[slug]/actions.ts#deletePageAction",
  "action:app/s/[slug]/actions.ts#removePageGrantAction",
  "action:app/s/[slug]/actions.ts#renamePageAction",
  "action:app/s/[slug]/actions.ts#restoreVersionAction",
  "action:app/s/[slug]/actions.ts#revokeShareAction",
  "action:app/s/[slug]/actions.ts#setPageCoverAction",
  "action:app/s/[slug]/actions.ts#setPageIconAction",
  "action:app/s/[slug]/actions.ts#togglePageRestrictionAction",
  "action:app/s/[slug]/favorite-actions.ts#removeFavoriteAction",
  "action:app/s/[slug]/favorite-actions.ts#toggleFavoriteAction",
  "action:app/s/[slug]/members/actions.ts#acceptInvitationAction",
  "action:app/s/[slug]/members/actions.ts#addSpaceGroupAction",
  "action:app/s/[slug]/members/actions.ts#changeRoleAction",
  "action:app/s/[slug]/members/actions.ts#inviteMemberAction",
  "action:app/s/[slug]/members/actions.ts#removeMemberAction",
  "action:app/s/[slug]/members/actions.ts#removeSpaceGroupAction",
  "action:app/s/[slug]/members/actions.ts#revokeInvitationAction",
  "action:app/s/[slug]/members/actions.ts#updateSpaceGroupRoleAction",
  "action:app/s/[slug]/p/[pageId]/comments/actions.ts#createThreadAction",
  "action:app/s/[slug]/p/[pageId]/comments/actions.ts#deleteCommentAction",
  "action:app/s/[slug]/p/[pageId]/comments/actions.ts#editCommentAction",
  "action:app/s/[slug]/p/[pageId]/comments/actions.ts#replyAction",
  "action:app/s/[slug]/p/[pageId]/comments/actions.ts#resolveThreadAction",
  "action:app/s/[slug]/p/[pageId]/comments/actions.ts#toggleSubscriptionAction",
  "action:app/s/[slug]/settings/actions.ts#deleteSpaceAction",
  "action:app/s/[slug]/settings/actions.ts#leaveSpaceAction",
  "action:app/s/[slug]/settings/actions.ts#updateSpaceAction",
  "action:app/s/[slug]/template-actions.ts#createTemplateAction",
  "action:app/s/[slug]/template-actions.ts#deleteTemplateAction",
  "action:app/s/[slug]/template-actions.ts#importBuiltinTemplateAction",
  "action:app/spaces/actions.ts#createSpaceAction",
  "action:app/spaces/actions.ts#joinSpaceAction",
  "route:app/api/account/export/route.ts#GET",
  "route:app/api/ai/assist/route.ts#POST",
  "route:app/api/favorites/route.ts#GET",
  "route:app/api/files/[name]/route.ts#GET",
  "route:app/api/health/route.ts#GET",
  "route:app/api/notifications/stream/route.ts#GET",
  "route:app/api/pages/[id]/export/route.ts#GET",
  "route:app/api/search/route.ts#GET",
  "route:app/api/share/[id]/files/[name]/route.ts#GET",
  "route:app/api/spaces/[id]/import/route.ts#POST",
  "route:app/api/spaces/[id]/pages/route.ts#GET",
  "route:app/api/spaces/[id]/suggest/route.ts#GET",
  "route:app/api/upload/route.ts#POST",
  "route:app/notifications/[id]/route.ts#GET",
  "route:app/p/[pageId]/print/route.ts#GET",
];
