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
- [x] Politique de confidentialité (PRIVACY.md), licence MIT (MPL 2.0 depuis la 0.11.1), README anglais et LISEZMOI à jour.
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

## Phase 6 : onglets (faite le 28/10/2026, version 0.9.0)

- [ ] ~~Aperçu au survol~~ : écarté, une extension ne peut rien afficher hors de sa barre de 48 px.
- [x] Pastilles de notifications : nombre entre parenthèses dans le titre (1 à 3 chiffres, « (3) Mastodon », « Boîte de réception (12) »), pastille rouge sur l'icône.
- [x] Anneau qui tourne autour de l'icône pendant le chargement.

## Phase 7 : favoris (faite le 28/10/2026, version 0.9.0)

- [x] Clic droit sur un favori : « Revenir à l'adresse du favori » ou « Mettre à jour le favori avec cette page ».
- [x] Glisser un lien d'une page web vers les tuiles crée un favori.
- [x] Favoris communs à tous les espaces (« Partager avec tous les espaces », bord en pointillés, un onglet par espace), aussi dans Alt+K.
- [x] Dossiers de liens sous les tuiles : faits en 0.12.0 (voir plus bas).

## Retours de la recette 0.9 (faits le 28/10/2026, version 0.10.0)

- [x] Installateur « une seule barre » pour Linux et macOS : script sh qui trouve les profils de Firefox (distribution, Flatpak, Snap d'Ubuntu, macOS), commande à copier dans la fenêtre. Plus de manipulation dans about:config.
- [x] Fenêtres (modifier l'espace, réglages, archive, groupe, une seule barre) en calque sur la page comme la recherche rapide, ou en panneau sous l'icône d'Arbalète sur les pages interdites (nouvel onglet, about:, sites de Mozilla). Nouveau style : cartes, interrupteurs, en-tête avec croix. Suppressions en deux clics (confirm() est interdit dans le panneau).
- [x] Fond de la barre au choix par espace : aucun, couleur de l'espace, dégradé à deux couleurs.
- [x] Icône d'espace : choix dans un pop-over au clic sur l'icône, ou image importée (SVG, PNG, JPEG), réduite à 64 px et synchronisée.
- [x] Couleurs par pastilles et réglette de teinte (le sélecteur natif fermerait le panneau).
- [x] Nouvel espace créé seulement à l'enregistrement de sa fenêtre.
- [x] Bascule horaire complète : plusieurs créneaux par espace, chacun avec ses jours (L M M J V S D) et sa plage d'heures, créneaux de nuit possibles ; l'ancien réglage est converti.
- [x] Sites d'un espace avec étoile (dev.*.behynd.app) ; une adresse invalide bloque l'enregistrement au lieu de disparaître.
- [x] Interrupteur « Fenêtres centrées sur la page » (autorisation tous les sites, petite fenêtre d'autorisation depuis le calque).
- [x] Clic molette sur un onglet : ferme (le défilement automatique de Firefox avalait le clic). Croix de fermeture au survol en mode compact.
- [x] Commentaires du code en anglais (dépôt public), textes de l'interface en français et en anglais.

## Phase 8 : plusieurs PC et prise en main (faite le 28/10/2026, version 0.11.0)

- [x] Mises à jour automatiques avant publication : `update_url` vers `updates.json` du dépôt GitHub public, chaque `.xpi` signé attaché à une Release. Publication : télécharger le `.xpi` signé sur AMO, puis `sh tools/release.sh <fichier.xpi>` (Release, `updates.json`, commit, push).
- [x] Modèles d'espaces : fenêtre « Partager des espaces » (Réglages) : export d'une sélection, avec ou sans favoris ; import d'un fichier en choisissant les espaces, ajoutés aux siens (modèle) ou à leur place (autre PC).
- [x] Assistant de premier lancement (onglet à l'installation, à revoir depuis les Réglages) : espaces de départ à choisir et renommer, ou fichier modèle, ou espaces déjà synchronisés détectés ; installateur « une seule barre » ; fenêtres centrées, teinte, historique, raccourcis.

## Après la 0.11.1 (version 0.11.2)

- [x] Réglage « Liens venant d'autres applications » : un lien sans règle ouvert depuis la messagerie ou une autre application va dans l'espace choisi (Perso…) au lieu de l'espace affiché ; les sites d'un espace restent prioritaires. Détection : Firefox au second plan ou revenu au premier plan depuis moins de 1,5 s (Wayland), onglet sans parent.
- [x] Correctif : un onglet activé pendant qu'Arbalète choisit son espace fait bien basculer la fenêtre.
- [x] Croix de fermeture reprises des onglets verticaux de Firefox 158 : pastille ronde en haut à gauche en compact, bouton de 24 px toujours visible sur l'onglet actif en déplié.

## Version 0.12.4 : ne plus écraser les espaces des autres PC

- [x] Correctif : avec un stockage vide (premier démarrage, ou extension retirée puis remise : Firefox efface alors son storage.sync local, module temporaire compris), loadSpaces enregistrait aussitôt les espaces par défaut, et Firefox Sync remplaçait les espaces de tous les autres PC (arrivé le 07/11/2026 en retirant un module temporaire). Les espaces par défaut restent maintenant provisoires : affichés, jamais écrits, jusqu'à ce que Sync ramène les espaces (rechargés par storage.onChanged) ou qu'une modification de l'utilisateur passe par saveSpaces. Un onglet d'un espace inconnu garde sa valeur de session et retrouve son espace à l'arrivée de Sync. La suppression d'un conteneur n'enregistre plus que si un espace l'utilisait.

## Version 0.12.3 : l'installateur qui remettait l'ancien CSS

- [x] Correctif : au deuxième téléchargement, Firefox enregistre l'installateur sous installer-arbalete(1).sh (ou .cmd), et la commande proposée (ou un double-clic dans le dossier Téléchargements) lançait l'ancien fichier, qui réinstallait l'ancien CSS : le bouton « Mettre à jour la barre » ne partait pas. La commande Linux et macOS lance le plus récent des installer-arbalete*.sh, et l'installateur s'efface une fois lancé (le .sh après un passage réussi, le .cmd après la pause).
- [x] Correctif : le bouton « Mettre à jour la barre » était toujours affiché, la règle display: flex des boutons du bas l'emportant sur l'attribut hidden (le banc de la 0.12.2 lisait l'attribut, pas l'affichage). Règle .tool[hidden] ajoutée ; le bouton « Garder la barre dépliée », affiché par ce même défaut depuis la 0.10.0 alors que le code le réservait à l'option « Élargir au survol », reste affiché exprès. Par prudence, la mesure demande aussi deux lectures courtes à 2 s d'écart, est relue à chaque changement de taille (ResizeObserver) et quand la barre redevient visible, et toutes les 10 s tant que le bouton est affiché.

## Version 0.12.2 : prévenir quand le userChrome.css est périmé

- [x] Le userChrome.css porte une version, lue par la barre dans sa propre largeur : la version 1 laissait les bordures de Firefox autour de la barre (46 ou 47 px utiles pour 48, 278 ou 279 pour 280), la version 2 les remplace par un contour dessiné par-dessus (même rendu) et la barre remplit exactement 48 ou 280 px. Une barre trop courte de 1 ou 2 px affiche un bouton « Mettre à jour la barre » (icône dans la couleur de l'espace, pastille) au-dessus des réglages ; il ouvre la fenêtre de l'installateur avec un message de mise à jour.
- [ ] Pour une prochaine version du CSS, il faudra une autre largeur témoin (par exemple un contour plus fin d'un côté) : celle-ci ne distingue que la version 1.

## Version 0.12.1 : barre bloquée sur les marque-pages, fenêtres

- [x] Correctif du userChrome.css : avec les onglets verticaux, Firefox ne met plus à jour le titre du panneau latéral quand on ouvre les marque-pages ou l'historique (Ctrl+B, Ctrl+H). Le titre restait « Arbalète » : les onglets natifs restaient masqués et le panneau des marque-pages était écrasé à 48 px, sans moyen d'en sortir. La barre d'Arbalète est maintenant repérée par son entrée cochée dans le menu Affichage > Panneau latéral, et l'en-tête n'est plus masqué que dans les panneaux d'extension. Les autres panneaux gardent au moins 300 px (Firefox pouvait leur laisser une largeur étroite). Un second Ctrl+B ferme le panneau sans rouvrir Arbalète : Alt+Maj+S. Relancer l'installateur pour en profiter.
- [x] Glisser un onglet hors de la barre (lâché sur la page, le bureau ou un autre écran) : il part dans sa propre fenêtre, de la taille de l'ancienne, qui affiche son espace. C'est la position du lâcher vue depuis la barre qui décide : sous Wayland, le glisser ne démarre qu'une fois le pointeur sorti de la barre étroite (aucun événement de survol), les coordonnées d'écran ne disent rien et une page peut accepter le lâcher. Seuls Échap et un dépôt sur la barre d'une autre fenêtre l'empêchent.
- [x] Pendant le glisser d'un onglet, une petite carte suit le pointeur (icône, titre, domaine, liseré de la couleur de l'espace) au lieu de la capture de la ligne. Dessinée sur un canevas à l'échelle 1 (Firefox lit sa taille en pixels CSS) ; elle ne peut pas changer en cours de route, Firefox fige l'image au départ du glisser.
- [x] Glisser un onglet sur la barre d'une autre fenêtre : il y passe, à l'endroit du dépôt (avant une ligne, ou en fin de liste), dans l'espace affiché ; lâché sur l'icône d'un espace, il rejoint cet espace.
- [x] Trait de placement pendant le glisser d'un onglet (de cette fenêtre ou d'une autre) : avant ou après la ligne survolée selon sa moitié, en fin de liste sous les onglets (le dépôt y range l'onglet en dernier), groupe ou dossier encadré. Lâché sur l'en-tête d'un groupe, l'onglet rejoint le groupe ; sur un dossier ou les tuiles, il vient d'abord dans la fenêtre puis devient un lien ou un favori.
- [x] Lâché parmi les onglets épinglés de Firefox, un onglet est épinglé à cet endroit ; un onglet épinglé lâché parmi les onglets ordinaires (ou sous la liste) est désépinglé et rejoint l'espace affiché.
- [x] « Ramener dans la fenêtre principale » (la fenêtre normale qui a le plus d'onglets) : clic droit sur un onglet d'une fenêtre secondaire, ou sur la page d'une fenêtre secondaire ou d'une pop-up (sans barre).
- [x] Une fenêtre faite d'un seul onglet détaché (menu, glisser, menu natif de Firefox) affiche l'espace de cet onglet ; l'ancienne fenêtre garde un onglet de son espace à l'écran.

## Version 0.12.0 : dossiers de liens

- [x] Dossiers de liens sous les tuiles, propres à chaque espace, comme les dossiers d'onglets épinglés d'Arc : nom, icône au choix (parmi les icônes des espaces, dossier par défaut) et couleur (le même nuancier que les espaces, réglette comprise), dépliés ou repliés. Ordre de la barre : tuiles, onglets épinglés de Firefox (communs à tous les espaces), dossiers, onglets. Un lien se comporte comme un favori : son onglet s'affiche sous le lien, pas dans la liste ; un dossier replié garde visible le lien de l'onglet actif.
- [x] Remplissage : glisser un onglet, un lien de page ou une tuile sur le dossier (ou avant un lien) ; clic droit sur un onglet, « Ajouter au dossier ». Une tuile se réordonne ou sort d'un dossier en la glissant sur les tuiles.
- [x] Clic droit sur un dossier : « Modifier le dossier… » (nom, icône et couleur), ouvrir tous les liens, fermer leurs onglets, supprimer le dossier et ses liens (les onglets ouverts restent, en onglets ordinaires). Sur un lien : « Sortir du dossier ».
- [x] Sites et conteneur du dossier, comme pour un espace : un onglet ouvert sur un site du dossier (depuis n'importe quel espace) rejoint l'espace du dossier, s'affiche sous le dossier après ses liens (sans devenir un lien) et s'ouvre dans le conteneur du dossier. Les sites d'un dossier passent avant ceux des espaces. Conteneur par défaut : celui de l'espace ; les liens du dossier s'ouvrent aussi dans le conteneur du dossier. Horaires, fond de barre et archive restent propres aux espaces.
- [x] Mode compact : l'icône de dossier dans sa couleur, les favicônes dessous avec le filet de couleur.
- [x] Stockage : clé `folders:<espace>` à part dans Firefox Sync (8 Ko par clé), modèles d'espaces et recherche rapide compris.

## Phase 9 : publication publique (faite le 02/11/2026, versions 0.11.1 et 0.11.2)

- [x] Fiche AMO en français et en anglais prête dans `amo/LISTING.md` (nom, résumés, descriptions, catégories, notes pour la relecture, plan des captures), icône `amo/icon-128.png`, politique de confidentialité à jour.
- [x] Build listé sans `update_url` : `sh build.sh listed` (ou `build.ps1 -Listed`), validé avec les règles des versions listées.
- [x] Captures d'écran 1280 × 800 (8, voir `amo/LISTING.md`), courte vidéo facultative.
- [x] Passage en « listée » sur AMO (relecture Mozilla), mises à jour automatiques pour tout le monde : 0.11.1 approuvée le 02/11/2026, 0.11.2 envoyée par l'API (`sh tools/submit.sh`) et validée le jour même.
- [x] Bascule des installations existantes : la version listée n'a plus d'`update_url` (AMO l'interdit) ; une dernière entrée de `updates.json` pointe vers le `.xpi` listé, ensuite AMO prend le relais.

## Écarté

- Synchroniser les onglets ouverts entre PC.
