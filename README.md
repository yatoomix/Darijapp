# Darijapp

App d'apprentissage de l'arabe algérien (derja). Contenu partagé, progression individuelle, utilisable hors ligne sur téléphone.

## État du projet

| Brique | État |
|---|---|
| Schéma de base de données | ✅ écrit et testé (14/14) |
| Contenu initial — 136 mots, 46 phrases, 18 verbes | ✅ prêt à importer |
| App connectée (auth + sync) | 🚧 en cours |
| PWA (installation sur mobile) | ⬜ à faire |
| Scripts du flux de traduction | ⬜ à faire |

## Architecture

- **Front** — HTML/CSS/JS sans framework, PWA installable
- **Hébergement** — Netlify
- **Base + Auth** — Supabase (Postgres, région Europe)
- **Sync** — local-first : écriture locale immédiate, envoi au serveur en arrière-plan

### Modèle de données

```
profiles     qui est qui
items        mots ET phrases (partagés)   ← kind = 'word' | 'sentence'
verbs        verbes et leurs 16 formes (partagés)
progress     scores, une ligne par item et par personne (privé)
activity     réponses par jour (privé)
```

Une phrase est un mot avec en plus `cloze_index`, d'où la table commune. Un verbe est une matrice de 16 formes, d'où sa table dédiée avec `forms` en `jsonb` et une contrainte qui refuse un verbe mal formé.

L'isolation entre utilisateurs est assurée par **Row Level Security**, donc par Postgres lui-même — pas par le code du navigateur.

---

## Mise en route

### 1. Créer la base

Dans le dashboard Supabase → **SQL Editor** :

1. Coller le contenu de `db/schema.sql`, *Run*.
   La requête finale doit afficher `rowsecurity = true` sur les 5 tables. Si ce n'est pas le cas, **arrête-toi** : la clé anon donnerait alors accès à tout.
2. Coller le contenu de `db/seed.sql`, *Run*.
   La requête finale doit afficher 136 mots, 46 phrases, 18 verbes.

Les deux scripts sont rejouables sans créer de doublon.

### 2. Configurer l'authentification

**Authentication → Sign In / Providers**

- Activer **Email**, en mode *Magic Link* (aucun mot de passe à retenir)
- **Désactiver les inscriptions publiques** (`Allow new users to sign up` → off)

**Authentication → Users → Invite user** : une invitation par email pour chaque proche. C'est ce qui garde l'app fermée à ton cercle.

### 3. Vérifier le schéma en local (optionnel)

Fait tourner le schéma et le contenu sur un vrai Postgres embarqué, sans rien installer :

```bash
cd db && npm install && npm test
```

14 assertions : contraintes d'intégrité, idempotence, transition `pending` → `ready`.

### 4. Déployer

À venir — Netlify, glisser-déposer du dossier `public/`.

---

## Le flux « cherche-moi la traduction »

Dans l'app, tu peux créer une carte avec **seulement le français**, en cochant une case. Elle part en base avec `status = 'pending'` : visible dans le Lexique, exclue des révisions tant qu'elle n'a pas de traduction — la base l'impose via la contrainte `ready_needs_translation`.

Ensuite, en session Cowork :

```bash
node scripts/pending.mjs      # exporte les cartes en attente vers pending.json
# → Claude remplit les traductions dans filled.json
node scripts/fill.mjs         # réinjecte, les cartes passent en 'ready'
```

Les scripts tournent **sur ta machine** : `supabase.co` n'est pas joignable depuis le sandbox de Claude.

Le champ `verified` est distinct de `ready`. Les traductions générées arrivent utilisables mais non validées — la derja n'a pas d'orthographe standard et varie d'Alger à Constantine. L'app te donne la liste à faire vérifier par un proche.

---

## Sécurité

- La clé `anon` est **conçue pour être publique**. Elle est sans danger tant que le RLS est actif, ce que vérifie la dernière requête de `schema.sql`.
- La clé `service_role` ne doit **jamais** apparaître dans le front ni dans un commit. Elle ne sert qu'aux scripts, depuis un `.env` local ignoré par git.
- Données personnelles collectées : les adresses email, rien d'autre.

## Structure

```
db/
  schema.sql         DDL + RLS + contraintes + triggers
  seed.sql           contenu initial (is_seed = true)
  test.mjs           14 assertions sur Postgres embarqué (pglite)
  test-prelude.sql   stubs des objets Supabase pour les tests hors ligne
public/              l'app (à venir)
scripts/             flux de traduction (à venir)
```
