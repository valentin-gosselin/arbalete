# Feuille de route Arbalète / Crossbow

Validée avec Valentin le 28/10/2026. Les phases sont dans l'ordre de réalisation : chacune donne une version testable, envoyée sur AMO (non listée) quand elle est stable.

Nom : **Arbalète** dans toutes les langues (décidé le 28/10/2026), clin d'œil à Arc ; sous-titre anglais « Arc-style spaces for Firefox ». Libre sur addons.mozilla.org au 28/10/2026. L'identifiant technique `arbalete@gosselin.pro` ne change pas, pour garder les installations et les espaces existants.

## Ce que Firefox 158 permet (vérifié dans ses fichiers)

- **Vue scindée** : une extension peut **lire** qu'un onglet fait partie d'une vue scindée native (`splitViewId`) mais **ne peut pas en créer**. Arbalète affiche les paires natives sur une ligne, et propose **sa propre vue scindée** (page à deux cadres, version 0.5.0) : en-têtes anti-cadre retirés, Referer pour le lecteur YouTube, service worker de YouTube effacé avant affichage, navigation interne suivie par un script de cadre, vues rouvertes après une mise à jour. Permission « tous les sites » + « données de navigation » demandée au premier usage. Impossible : sites de Mozilla protégés (addons.mozilla.org…).
- **Menu d'onglet natif** : quand une extension ouvre le menu d'un onglet (`menus.overrideContext`), Firefox n'y met que les entrées des extensions, aucune des siennes. Arbalète recrée donc le menu de Firefox avec ce que les API permettent ; impossible : vue scindée, envoi vers un appareil, marque-page (permission en plus), notes d'onglet.

## Phase 1 : fondations pour la publication (faite le 28/10/2026, version 0.3.0)

Fait en premier car tous les textes ajoutés ensuite en dépendent.

- [x] Traduction : tous les textes dans `_locales/fr` et `_locales/en` (source : `tools/messages.js`), menus, fenêtres, installateur.
- [x] Accessibilité : navigation au clavier dans la barre (flèches, Début/Fin, Entrée, Suppr), libellés pour lecteurs d'écran, focus visible.
- [x] Validateur de Mozilla (addons-linter) : 0 erreur, 0 avertissement. Firefox 142 minimum.
- [x] Politique de confidentialité (PRIVACY.md), licence MIT, README anglais et LISEZMOI à jour.
- [x] Dépôt git local. Dépôt public (GitHub ou forge perso) au moment de publier.

## Phase 2 : clic droit et vue scindée (faite le 28/10/2026, version 0.4.0)

- [x] Menu d'onglet de Firefox recréé : nouvel onglet, groupes, actualiser, son, épingler, décharger, dupliquer, copier l'adresse, déplacer (début, fin, nouvelle fenêtre), rouvrir dans un conteneur, tout sélectionner, fermer, doublons, au-dessus / en dessous / autres, rouvrir l'onglet fermé. Uniquement depuis la barre, pour ne pas doubler le vrai menu.
- [x] Affichage des vues scindées : les deux onglets sur une ligne (empilés en mode compact).
- [x] Multi-sélection (Ctrl+clic, Maj+clic, Échap pour vider), partagée avec celle de Firefox ; tout le menu d'onglet agit sur la sélection.

## Phase 3 : recherche rapide et raccourcis (faite le 28/10/2026, version 0.6.0)

- [x] Palette de recherche (Alt+K, loupe en bas de la barre, bouton d'outils) : onglets de tous les espaces, favoris, historique (option des réglages), adresse, recherche Web ; Entrée bascule sur le bon espace. Onglets archivés : avec la phase 4.
- [x] Commandes dans la palette (« > » pour ne voir qu'elles) : nouvel onglet / espace, vue scindée, copier, dupliquer, doublons, nettoyer, rouvrir, aller à l'espace…, déplacer l'onglet vers…, réglages, raccourcis.
- [x] Raccourcis : onglet vers l'espace suivant / précédent (Alt+Maj+→ / ←), favoris 1 à 5 (sans touche par défaut, à choisir). Ctrl+T ouvre déjà dans l'espace actif.

## Phase 4 : nettoyage automatique (faite le 28/10/2026, version 0.7.0)

- [x] Délai réglable par espace dans « Modifier l'espace » (jamais, 12 h, 24 h, 7 jours) : les onglets inactifs partent dans l'**archive** de l'espace (exclus : actif, épinglés, favoris, son, sélection, groupes, pages internes). Vérification toutes les 10 min. « Fermer les onglets de l'espace » archive aussi.
- [x] Archive : bouton en bas de la barre (fenêtre avec recherche, réouverture, retrait, vider) et section « Archive » de la recherche rapide ; purge après 30 jours ; propre à chaque PC (storage.local).
- [x] Doublons : « Fermer les onglets en double » (clic droit et recherche rapide, depuis la 0.4.0).

## Phase 5 : espaces (faite le 28/10/2026, version 0.8.0)

- [x] Règles par site (« Sites de cet espace ») : l'onglet rejoint l'espace, rouvert dans son conteneur si besoin ; on suit si c'est l'onglet affiché.
- [x] Bascule horaire par espace (semaine / week-end / tous les jours, plage d'heures, plages de nuit possibles) : une seule bascule à l'entrée dans la plage.
- [x] Thème : option des réglages qui teinte Firefox (cadre, barre d'outils, champ d'adresse) aux couleurs de l'espace ; fond de la barre en dégradé avec une 2e couleur facultative. (Image de fond : non retenue.)
- [x] Statistiques : temps passé par espace (fenêtre au premier plan), barres sur 7 jours dans les réglages, 14 jours gardés, propre au PC.

## Phase 6 : onglets

- [ ] Aperçu au survol (vignette de la page) en mode compact.
- [ ] Pastilles de notifications : nombre de non-lus lu dans le titre des pages (« (3) Boîte de réception »), affiché sur l'icône.
- [ ] Indicateur de chargement plus visible (anneau autour du favicon).

## Phase 7 : favoris

- [ ] Comportement réglable par favori : revenir à l'adresse d'origine ou garder la dernière page.
- [ ] Glisser un lien d'une page web vers les tuiles pour créer un favori.
- [ ] Favoris communs à tous les espaces (petite rangée au-dessus des espaces).
- [ ] Dossiers de liens sous les tuiles, comme les onglets épinglés d'Arc.

## Phase 8 : plusieurs PC et prise en main

- [ ] Mises à jour automatiques avant publication : `update_url` vers un petit fichier JSON hébergé en HTTPS (lien public Nextcloud ou serveur personnel).
- [ ] Modèles d'espaces : enregistrer un ou plusieurs espaces (icônes, couleurs, favoris, règles) comme modèle à partager ou réimporter, choisis par l'utilisateur.
- [ ] Assistant de premier lancement : créer ses espaces, choisir les icônes, masquer les onglets natifs.

## Phase 9 : publication publique

- [ ] Fiche AMO en français et en anglais : description, captures, courte vidéo.
- [ ] Passage en « listée » sur AMO (relecture Mozilla), mises à jour automatiques pour tout le monde.

## Écarté

- Synchroniser les onglets ouverts entre PC.
