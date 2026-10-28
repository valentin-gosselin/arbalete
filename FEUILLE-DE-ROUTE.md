# Feuille de route Arbalète / Crossbow

Validée avec Valentin le 28/10/2026. Les phases sont dans l'ordre de réalisation : chacune donne une version testable, envoyée sur AMO (non listée) quand elle est stable.

Nom : **Arbalète** dans toutes les langues (décidé le 28/10/2026), clin d'œil à Arc ; sous-titre anglais « Arc-style spaces for Firefox ». Libre sur addons.mozilla.org au 28/10/2026. L'identifiant technique `arbalete@gosselin.pro` ne change pas, pour garder les installations et les espaces existants.

## Ce que Firefox 158 permet (vérifié dans ses fichiers)

- **Vue scindée** : une extension peut **lire** qu'un onglet fait partie d'une vue scindée (`splitViewId`) mais **ne peut pas en créer**. Arbalète peut donc afficher les paires scindées (une seule ligne à deux favicons, comme Firefox) ; la création reste dans le menu natif de Firefox.
- **Menu d'onglet natif** : Arbalète l'ouvre déjà via `menus.overrideContext`, mais Firefox y masque les entrées liées à la barre d'onglets (vue scindée, certains choix de groupe). Ce qu'on ne peut pas récupérer est recréé par Arbalète quand une API existe (groupes : fait ; vue scindée : impossible tant que Firefox n'ouvre pas l'API).

## Phase 1 : fondations pour la publication (faite le 28/10/2026, version 0.3.0)

Fait en premier car tous les textes ajoutés ensuite en dépendent.

- [x] Traduction : tous les textes dans `_locales/fr` et `_locales/en` (source : `tools/messages.js`), menus, fenêtres, installateur.
- [x] Accessibilité : navigation au clavier dans la barre (flèches, Début/Fin, Entrée, Suppr), libellés pour lecteurs d'écran, focus visible.
- [x] Validateur de Mozilla (addons-linter) : 0 erreur, 0 avertissement. Firefox 142 minimum.
- [x] Politique de confidentialité (PRIVACY.md), licence MIT, README anglais et LISEZMOI à jour.
- [x] Dépôt git local. Dépôt public (GitHub ou forge perso) au moment de publier.

## Phase 2 : clic droit et vue scindée

- [ ] Inventaire précis des entrées natives absentes du menu d'onglet ouvert depuis Arbalète, et recréation de celles qu'une API permet (dupliquer, recharger, épingler, couper le son, déplacer vers une fenêtre, fermer les autres / à droite, rouvrir).
- [ ] Affichage des vues scindées : les deux onglets sur une ligne, comme Firefox.
- [ ] Multi-sélection (Ctrl+clic, Maj+clic) avec actions groupées : déplacer, grouper, fermer, mettre en favoris.

## Phase 3 : recherche rapide et raccourcis

- [ ] Palette de recherche (raccourci configurable) : onglets de tous les espaces, favoris, onglets archivés, historique ; Entrée bascule sur le bon espace.
- [ ] Commandes dans la palette : « nouvel espace », « déplacer l'onglet vers… », « nettoyer l'espace »…
- [ ] Raccourcis supplémentaires : nouvel onglet dans l'espace, favori 1 à 9, onglet vers l'espace suivant / précédent.

## Phase 4 : nettoyage automatique

- [ ] Délai réglable par espace (jamais, 12 h, 24 h, 7 jours) : les onglets inactifs partent dans l'**archive** de l'espace (favoris, onglets épinglés et onglets qui jouent du son exclus).
- [ ] Archive consultable dans la barre et dans la recherche rapide, réouverture en un clic, purge après 30 jours.
- [ ] Doublons : repérer les onglets ouverts deux fois dans un espace et proposer de les fusionner.

## Phase 5 : espaces

- [ ] Règles par site : « tout lien vers tel domaine s'ouvre dans tel espace » (avec conteneur si l'espace en a un).
- [ ] Règles horaires : bascule automatique d'espace selon le jour et l'heure, désactivable.
- [ ] Thème par espace : la couleur de l'espace teinte l'interface de Firefox (API des thèmes), fond en dégradé deux couleurs ou image.
- [ ] Statistiques : nombre d'onglets et temps passé par espace, sur la semaine.

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
