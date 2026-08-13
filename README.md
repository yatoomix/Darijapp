# Darijapp

App d'apprentissage de l'arabe algérien (derja). Contenu partagé, progression individuelle, utilisable hors ligne sur téléphone.

## État du projet

| Brique | État |
|---|---|
| Schéma de base de données | ✅ appliqué en prod, 15/15 tests, 0 alerte de sécurité |
| Contenu — 136 mots, 46 phrases, 18 verbes | ✅ importé |
| Isolation entre utilisateurs | ✅ vérifiée avec deux comptes de test |
| App connectée (auth + sync local-first) | ✅ construite |
| PWA (installation sur mobile) | ✅ manifest + service worker + icônes |
| Déploiement Netlify | ⬜ à faire — voir §3 |
| Configuration de l'authentification | ⬜ à faire — voir §2 |

## Architecture

- **Front** — HTML/CSS/JS sans framework ni build, PWA installable (~128 Ko)
- **Hébergement** — Netlify, dossier `public/`
- **Base + Auth** — Supabase, projet `ypsnpwcznhcvfljuibnn` (eu-west-1)
- **Sync** — local-first : écriture locale immédiate, envoi groupé toutes les 8 s

### Modèle de données

```
profiles     qui est qui
items        mots ET phrases (partagés)   ← kind = 'word' | 'sentence'
verbs        verbes et leurs 16 formes (partagés)
progress     scores, une ligne par item et par personne (privé)
activity     réponses par jour (privé)
```

Une phrase est un mot avec en plus `cloze_index`, d'où la table commune. Un verbe est une matrice de 16 formes, d'où sa table dédiée avec `forms` en `jsonb`.

L'isolation entre utilisateurs est assurée par **Row Level Security**, donc par Postgres lui-même — pas par le code du navigateur. La clé `anon` présente dans `public/app.js` est conçue pour être publique : sans compte, elle ne donne accès à rien.

### Ce que la base refuse

Les contraintes ne sont pas décoratives — elles empêchent des bugs de rendu de remonter jusqu'à l'écran :

- une carte marquée révisable **sans traduction** → une flashcard sans réponse
- une phrase **sans** `cloze_index`, ou dont l'index désigne un mot inexistant → un trou dans le vide
- un verbe révisable avec **autre chose que 8+8 formes** → un tableau de conjugaison troué
- un doublon de français au sein d'un même `kind`

### Modes de fonctionnement

| | Connecté | Hors ligne |
|---|---|---|
| Contenu | depuis la base, à jour | contenu initial embarqué |
| Progression | synchronisée entre appareils | locale à cet appareil |
| Ajout de cartes | partagé avec les autres | local uniquement |
| Sans réseau | file d'attente, envoi au retour | fonctionne normalement |

---

## Mise en route

### 1. Base de données — ✅ fait

`db/schema.sql` puis `db/seed.sql` sont appliqués. Les deux sont rejouables sans créer de doublon et restent la référence en cas de reconstruction.

Pour revalider le schéma en local, sur un vrai Postgres embarqué, sans rien installer :

```bash
cd db && npm install && npm test
```

15 assertions : contraintes d'intégrité, idempotence, transition `pending` → `ready`.

### 2. Authentification — à faire

Dans le dashboard Supabase :

- **Authentication → Sign In / Providers** : activer **Email** en mode *Magic Link*, puis **désactiver les inscriptions publiques** (`Allow new users to sign up` → off). Tant que c'est ouvert, n'importe qui peut se créer un compte et lire le deck.
- **Authentication → URL Configuration** : ajouter l'URL Netlify dans *Site URL* et *Redirect URLs*, sinon le lien de connexion renverra vers `localhost`.
- **Authentication → Users → Invite user** : une invitation par email pour chaque proche.

### 3. Déploiement Netlify — à faire

Le plus simple, via l'interface :

1. netlify.com → *Add new site* → *Import an existing project* → GitHub → `yatoomix/Darijapp`
2. Netlify lit `netlify.toml` : rien à configurer, le dossier publié est `public/`
3. Chaque `git push` redéploie automatiquement

Ou en glisser-déposer, sans git : déposer le dossier `public/` sur netlify.com/drop.

Puis retourner au §2 renseigner l'URL obtenue dans la configuration Supabase.

### 4. Installer sur téléphone

Ouvrir l'URL dans **Safari** (iOS) ou Chrome (Android) → *Partager* → *Sur l'écran d'accueil*. L'app s'ouvre alors en plein écran et fonctionne sans réseau.

---

## Le flux « cherche-moi la traduction »

Dans le Lexique, tu peux créer une carte avec **seulement le français**, en cochant la case. Elle part en base avec `status = 'pending'` : visible avec un badge, comptée dans le bandeau d'alerte, mais **exclue des révisions** — la base l'impose via `ready_needs_translation`.

Ensuite, en session Cowork, il suffit de demander « complète mes cartes en attente ». Le connecteur Supabase permet de lire les lignes `pending` et de les remplir directement, sans script ni clé `service_role`.

Le champ `verified` est distinct de `ready`. Les traductions générées arrivent utilisables mais non validées — la derja n'a pas d'orthographe standard et varie d'Alger à Constantine. Fais-les confirmer par un proche avant de les mémoriser : une forme fausse est plus coûteuse à désapprendre qu'à apprendre.

---

## Sécurité

- La clé `anon` est **publique par conception** et sans danger tant que le RLS est actif. Vérifié : sans compte, elle ne renvoie aucune ligne.
- La clé `service_role` ne doit **jamais** apparaître dans le front ni dans un commit. Elle n'est utilisée nulle part dans ce projet.
- Les fonctions `handle_new_user` et `touch_updated_at` sont en `SECURITY DEFINER` avec `search_path` figé, et leur droit d'exécution est révoqué pour `anon` et `authenticated` — sans quoi Supabase les exposerait via `/rest/v1/rpc`.
- Données personnelles collectées : les adresses email, rien d'autre.

## Structure

```
db/
  schema.sql         DDL + RLS + contraintes + triggers
  seed.sql           contenu initial (is_seed = true)
  test.mjs           15 assertions sur Postgres embarqué (pglite)
  test-prelude.sql   stubs des objets Supabase pour les tests hors ligne
public/
  index.html         markup + styles
  app.js             logique, auth, synchronisation
  seed-data.js       contenu de repli hors ligne (généré)
  sw.js              service worker
  manifest.webmanifest
  icons/
netlify.toml         publication, redirections SPA, en-têtes de sécurité
```
