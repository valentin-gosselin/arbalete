# Arbalète

**Des espaces façon Arc dans Firefox**, dans une barre latérale compacte. Arbalète, parce qu'Arc.

English version: [README.md](README.md).

## Ce que ça fait

- **Espaces** : chaque espace a ses onglets, ses favoris, sa couleur, son icône et, si on veut, son propre conteneur Firefox (comptes connectés séparés). Changer d'espace masque les onglets des autres espaces dans la même fenêtre.
- **Changer d'espace** : icônes en bas, glissé horizontal ou Maj+molette n'importe où dans la barre, Alt+1 à Alt+5, Alt+Maj+Haut/Bas.
- **Modifier un espace** : double-clic sur son icône, ou clic droit puis « Modifier l'espace… » (nom, icône parmi 1 900, couleur, conteneur).
- **Favoris** : tuiles en haut de chaque espace. Glisser un onglet dessus, ou clic droit sur l'onglet.
- **Dossiers de liens** : sous les tuiles, des dossiers avec un nom, une icône et une couleur (clic droit, « Nouveau dossier… »). Un lien garde son propre onglet, affiché sous le lien ; on y glisse des onglets, des liens de page ou des tuiles. Comme un espace, un dossier peut avoir ses sites (leurs onglets se rangent sous lui, d'où qu'ils viennent) et son conteneur.
- **Groupes d'onglets** : affichés avec leur couleur, repliables. Clic droit sur un onglet pour l'ajouter à un groupe, clic droit sur un groupe pour le renommer, le dissocier, le déplacer vers un espace ou le fermer.
- **Clic droit** sur un onglet : le menu natif de Firefox, plus les actions d'Arbalète.
- **Fenêtres** : glisser un onglet hors de la barre lui donne sa propre fenêtre ; le glisser sur la barre d'une autre fenêtre l'y déplace (lâché sur l'icône d'un espace, il rejoint cet espace). Clic droit sur un onglet ou sur la page d'une fenêtre secondaire ou d'une pop-up : « Ramener dans la fenêtre principale ».
- **Mode compact** : icônes seules, titres en infobulle. En option (Réglages) : élargissement au survol, et bouton en bas pour garder la barre dépliée.
- **Une seule barre** : Réglages, « Masquer les onglets natifs de Firefox… » télécharge un petit installateur (Windows, sans droits administrateur) qui masque les onglets de Firefox quand Arbalète est ouverte. Quand une mise à jour d'Arbalète le modifie, un bouton en bas de la barre propose de relancer l'installateur.
- **Clavier** : flèches, Entrée et Suppr dans la liste des onglets. Alt+Maj+C copie l'adresse de l'onglet, Alt+Maj+S affiche ou masque la barre.

## Installer

- **Version signée** : glisser le fichier `.xpi` dans une fenêtre Firefox. Le garder dans Nextcloud pour l'installer sur les autres PC.
- **Pour tester une version en cours** : `about:debugging#/runtime/this-firefox`, « Charger un module complémentaire temporaire », choisir `manifest.json`. Elle remplace la version signée jusqu'au redémarrage de Firefox ; après une modification, bouton « Actualiser ».

## Publier une nouvelle version (non listée)

1. Augmenter `version` dans `manifest.json`.
2. `powershell -File build.ps1` crée `arbalete-<version>.zip` (vrai zip, chemins en `/`).
3. Sur https://addons.mozilla.org/developers/, page d'Arbalète, « Envoyer une nouvelle version » : « À vous de jouer », envoyer le zip, code source « Non ».
4. Télécharger le `.xpi` signé et l'installer.

## Retrouver ses espaces sur un autre PC

- **Firefox Sync** : si Firefox est connecté au même compte avec « Modules complémentaires » coché, les espaces, icônes, couleurs, favoris et conteneurs (retrouvés par leur nom) suivent tout seuls.
- **Par fichier** : Réglages, « Partager des espaces » : exporter tout ou une sélection, puis importer sur l'autre PC, à la place des espaces existants ou en plus (un fichier sert ainsi de modèle d'espaces à donner à quelqu'un).

## Mises à jour automatiques (versions non listées)

Firefox vérifie `updates.json` du dépôt GitHub. Pour publier une version : l'envoyer sur AMO, télécharger le `.xpi` signé, puis `sh tools/release.sh <fichier.xpi>` crée la Release GitHub, ajoute la version à `updates.json`, commite et pousse.

Les onglets ouverts restent propres à chaque PC.

## Traductions

Tous les textes sont dans `tools/messages.js` (français et anglais). Après modification : `node tools/messages.js` régénère `_locales/`.

## Confidentialité et licence

Rien n'est collecté ni envoyé : voir [PRIVACY.md](PRIVACY.md). Licence Mozilla Public License 2.0 (MPL-2.0) : [LICENSE](LICENSE) ; les versions jusqu'à la 0.11.0 sont parues sous licence MIT. Icônes Lucide, licence ISC.
