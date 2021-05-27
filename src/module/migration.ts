// @ts-nocheck
// We do not care about this file being super rigorous

import { handleActorExport } from "./helpers/io";
import { LancerActor } from "./actor/lancer-actor";
import { updateCore } from "./apps/lcpManager";

/**
 * Perform a system migration for the entire World, applying migrations for Actors, Items, and Compendium packs
 * @return {Promise}      A Promise which resolves once the migration is completed
 */
export const migrateWorld = async function (migrateComps = true, migrateActors = false) {
  ui.notifications.info(
    `Applying LANCER System Migration for version ${game.system.data.version}. Please be patient and do not close your game or shut down your server.`,
    { permanent: true }
  );

  // Migrate World Compendium Packs
  if (migrateComps) {
    await scorchedEarthCompendiums();
    // await updateCore("3.0.21");

    // for (let p of game.packs) {
    //   if (p.metadata.package === "world" && ["Actor", "Item", "Scene"].includes(p.metadata.entity)) {
    //     await migrateCompendium(p);
    //   }
    // }
  }

  // Migrate World Actors
  if (migrateActors) {
    for (let a of game.actors.values()) {
      try {
        if (a.data.type === "pilot") {
          const ret = handleActorExport(a, false);
          if (ret) {
            console.log(`== Migrating Actor entity ${a.name}`);
            (a as LancerActor).importCC(ret);
            console.log(ret);
          }
        }
      } catch (err) {
        console.error(err);
        console.error(`== Migrating Actor entity ${a.name} failed.`);
      }
    }
  }

  // // Migrate World Items
  // for (let i of game.items.entities) {
  //   try {
  //     const updateData = migrateItemData(i);
  //     if (!isObjectEmpty(updateData)) {
  //       console.log(`Migrating Item entity ${i.name}`);
  //       await i.update(updateData, { enforceTypes: false });
  //     }
  //   } catch (err) {
  //     console.error(err);
  //   }
  // }

  // // Migrate Actor Override Tokens
  // for (let s of game.scenes.entities) {
  //   try {
  //     const updateData = migrateSceneData(s);
  //     if (updateData && !isObjectEmpty(updateData)) {
  //       console.log(`Migrating Scene entity ${s.name}`);
  //       await s.update(updateData, { enforceTypes: false });
  //     }
  //   } catch (err) {
  //     console.error(err);
  //   }
  // }

  // Set the migration as complete
  // await game.settings.set(LANCER.sys_name, LANCER.setting_migration, game.system.data.version);
  ui.notifications.info(`LANCER System Migration to version ${game.system.data.version} completed!`, {
    permanent: true,
  });
};

/* -------------------------------------------- */

const compTitles = [
  "Skill Triggers",
  "Talents",
  "Core Bonuses",
  "Pilot Armor",
  "Pilot Weapons",
  "Pilot Gear",
  "Frames",
  "Systems",
  "Weapons",
  "NPC Classes",
  "NPC Templates",
  "NPC Features",
];
export const scorchedEarthCompendiums = async () => {
  game.packs
    .filter(comp => compTitles.includes(comp.title))
    .forEach(async comp => {
      await comp.configure({ locked: false });
      await comp.deleteCompendium();
    });

  await game.settings.set("lancer", "coreDataVersion", "0.0.0");
};

/**
 * Apply migration rules to all Entities within a single Compendium pack
 * @param pack
 * @return {Promise}
 */
export const migrateCompendium = async function (pack: Compendium) {
  const wasLocked = pack.locked;
  await pack.configure({ locked: false });
  if (pack.locked) return ui.notifications.error(`Could not migrate ${pack.collection} as it is locked.`);
  const entity = pack.metadata.entity;
  if (!["Actor", "Item", "Scene"].includes(entity)) return;

  // Begin by requesting server-side data model migration and get the migrated content
  await pack.migrate({});

  const content = await pack.getDocuments();

  // Iterate over compendium entries - applying fine-tuned migration functions
  for (let ent of content) {
    try {
      let updateData = null;
      if (entity === "Item") updateData = migrateItemData(ent as Item);
      else if (entity === "Actor") updateData = migrateActorData(ent as Actor);
      else if (entity === "Scene") updateData = migrateSceneData(ent.data);
      if (!isObjectEmpty(updateData)) {
        expandObject(updateData);
        updateData["_id"] = ent._id;
        await pack.updateEntity(updateData);
        console.log(`Migrated ${entity} entity ${ent.name} in Compendium ${pack.collection}`);
      }
    } catch (err) {
      console.error(err);
    }
  }
  await pack.configure({ locked: wasLocked });
  console.log(`Migrated all ${entity} entities from Compendium ${pack.collection}`);
};

/* -------------------------------------------- */
/*  Entity Type Migration Helpers               */
/* -------------------------------------------- */

/**
 * Migrate a single Actor entity to incorporate latest data model changes
 * Return an Object of updateData to be applied
 * @param {Actor} actor   The actor to Update
 * @return {Object}       The updateData to apply
 */
export const migrateActorData = function (actor: Actor) {
  const updateData: any = {};
  const ad: ActorData = actor.data;

  // Insert code to migrate actor data model here

  // Migrate Owned Items
  if (!actor.items) return updateData;
  let hasItemUpdates = false;
  const items = actor.items.map(i => {
    // Migrate the Owned Item
    let itemUpdate = migrateItemData(i);

    // Update the Owned Item
    if (!isObjectEmpty(itemUpdate)) {
      hasItemUpdates = true;
      return mergeObject(i, itemUpdate, { enforceTypes: false, inplace: false });
    } else return i;
  });
  if (hasItemUpdates) updateData.items = items;

  // Remove deprecated fields
  _migrateRemoveDeprecated(actor, updateData);

  return updateData;
};

/* -------------------------------------------- */

/**
 * Scrub an Actor's system data, removing all keys which are not explicitly defined in the system template
 * @param {ActorData} actorData    The data object for an Actor
 * @return {ActorData}             The scrubbed Actor data
 */
function cleanActorData(actorData: ActorData) {
  // Scrub system data
  const model = game.system.model.Actor[actorData.type];
  actorData.data = filterObject(actorData.data, model);

  // Scrub system flags
  const allowedFlags = CONFIG.LANCER.allowedActorFlags.reduce((obj, f) => {
    obj[f] = null;
    return obj;
  }, {});
  if (actorData.flags.dnd5e) {
    actorData.flags.dnd5e = filterObject(actorData.flags.dnd5e, allowedFlags);
  }

  // Return the scrubbed data
  return actorData;
}

/* -------------------------------------------- */

/**
 * Migrate a single Item entity to incorporate latest data model changes
 * @param item
 */
export const migrateItemData = function (item: Item) {
  const updateData = {};

  // Remove deprecated fields
  _migrateRemoveDeprecated(item, updateData);

  // Return the migrated update data
  return updateData;
};

/* -------------------------------------------- */

/**
 * Migrate a single Scene entity to incorporate changes to the data model of it's actor data overrides
 * Return an Object of updateData to be applied
 * @param {Object} scene  The Scene data to Update
 * @return {Object}       The updateData to apply
 */
export const migrateSceneData = function (scene) {
  if (!scene.tokens) return;
  const tokens = duplicate(scene.tokens);
  return {
    tokens: tokens.map(t => {
      if (!t.actorId || t.actorLink || !t.actorData.data) {
        t.actorData = {};
        return t;
      }
      const token = new Token(t);
      if (!token.actor) {
        t.actorId = null;
        t.actorData = {};
      } else if (!t.actorLink) {
        const updateData = migrateActorData(token.data.actorData);
        t.actorData = mergeObject(token.data.actorData, updateData);
      }
      return t;
    }),
  };
};

/* -------------------------------------------- */

/**
 * A general migration to remove all fields from the data model which are flagged with a _deprecated tag
 * @private
 */
const _migrateRemoveDeprecated = function (ent, updateData) {
  const flat = flattenObject(ent.data);

  // Identify objects to deprecate
  const toDeprecate = Object.entries(flat)
    .filter(e => e[0].endsWith("_deprecated") && e[1] === true)
    .map(e => {
      let parent = e[0].split(".");
      parent.pop();
      return parent.join(".");
    });

  // Remove them
  for (let k of toDeprecate) {
    let parts = k.split(".");
    parts[parts.length - 1] = "-=" + parts[parts.length - 1];
    updateData[`data.${parts.join(".")}`] = null;
  }
};
