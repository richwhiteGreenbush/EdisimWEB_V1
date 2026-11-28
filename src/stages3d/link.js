// The link between Edusim Stages and this app (plan: edusim-stages-to-3d-plan.md, section 5).
//
//   /app/?from-stages=<token>   a project arriving: a new world built round it ('convert'), or one
//                               stage in the open world brought up to date ('update')
//   BroadcastChannel            while both apps are open, Stages' "Back to 3D" updates the stage in
//                               this tab at once, and this tab says so
//
// The token names a handoff Stages stored in this browser a moment ago (Stages/src/project/handoff.js);
// it is never a project or an address, the ?world= rule.
import { CHANNEL, sweepHandoffs, takeHandoff, takeTokenParam } from '../../Stages/src/project/handoff.js';
import { stageFootprint } from './StageObject.js';
import { findPlacementSpot, framingDistance } from '../models/index.js';
import { PRESET_WORLDS } from '../WorldPresets.js';
import { uuid } from '../Uuid.js';

export const STAGES_PARAM = 'from-stages';

// Read before the world is built, so a refresh cannot replay it.
export function takeStagesToken() {
  return takeTokenParam(STAGES_PARAM);
}

function projectBlob(text) {
  return new Blob([text], { type: 'application/json' });
}

export function installStagesLink(deps) {
  const { registry, worldStore, menu } = deps;
  sweepHandoffs();

  // Replaces one stage's project and rebuilds it in place, everything else untouched.
  async function updateStage(recordId, projectText) {
    const item = registry.get(recordId);
    if (!item || item.record?.kind !== 'stages-project') return false;
    const record = { ...item.record, files: [{ name: 'project.edusim-stages.json', type: 'application/json', data: projectBlob(projectText) }] };
    registry.remove(recordId);
    await worldStore.rehydrateOne(record);
    await worldStore.saveObject(record);
    return true;
  }

  let channel = null;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = async (e) => {
      const msg = e.data || {};
      if (msg.type !== 'project-updated' || typeof msg.projectText !== 'string') return;
      if (!registry.get(msg.recordId)) return; // another tab has it, or nobody does
      try {
        const ok = await updateStage(msg.recordId, msg.projectText);
        if (ok) {
          channel.postMessage({ type: 'project-updated-ok', recordId: msg.recordId });
          menu?.toast('Your stage has the new version from Edusim Stages.', { tone: 'success' });
        }
      } catch (err) {
        console.error('[stages3d] update failed', err);
      }
    };
  } catch { /* no BroadcastChannel: the token path below still works */ }

  async function arrive(token) {
    let payload;
    try {
      payload = await takeHandoff(token);
    } catch (err) {
      console.error(err);
    }
    if (!payload) {
      menu?.toast('That link from Edusim Stages has expired. Press Convert to 3D World in Stages again.', { tone: 'error' });
      return false;
    }
    if (payload.type === 'update') {
      const ok = await updateStage(payload.recordId, payload.projectText).catch(() => false);
      if (ok) { menu?.toast('Your stage has the new version from Edusim Stages.', { tone: 'success' }); return true; }
      // The stage is not in this world any more: build it a new one instead.
    }
    return convert(payload);
  }

  async function convert(payload) {
    const title = String(payload.title || 'My project').slice(0, 60);
    if (worldStore.hasChanges && registry.count > 0) {
      const replace = await confirmReplace(title);
      if (!replace) {
        menu?.toast('Your world was kept. Your project is still safe in Edusim Stages.');
        return false;
      }
    }
    deps.beforeLoad?.();
    const preset = PRESET_WORLDS[payload.preset] ? payload.preset : 'empty';
    await deps.loadPresetWorld(preset, { except: preset === 'empty' ? ['welcome-board', 'tutorial-board'] : [] });
    const layout = payload.layout === 'board' ? 'board' : 'set';
    const size = ['small', 'life', 'huge'].includes(payload.size) ? payload.size : 'life';
    const { camera, groundHeightAt } = deps;
    camera.updateMatrixWorld();
    const fp = stageFootprint(layout, size);
    const eye = camera.position.y - groundHeightAt(camera.position.x, camera.position.z);
    const distance = framingDistance({ width: fp.width, height: fp.height, depth: fp.depth, eye, aspect: camera.aspect }) * 1.05;
    // The radius covers the audience's side as well as the stage, so a spot with scenery standing
    // where the student would watch from scores worse.
    const radius = Math.max(Math.max(fp.width, fp.depth) / 2 + 1, distance * 0.45);
    const { x, z } = findPlacementSpot({ camera, registry, distance, radius, height: fp.height, groundHeightAt });
    // The stage faces the student: its +Z, the audience side, points back at where they stand.
    const yaw = Math.atan2(camera.position.x - x, camera.position.z - z);
    const record = {
      id: uuid(),
      kind: 'stages-project',
      createdAt: Date.now(),
      title,
      layout,
      size,
      files: [{ name: 'project.edusim-stages.json', type: 'application/json', data: projectBlob(payload.projectText) }],
      transform: { position: [x, groundHeightAt(x, z), z], rotation: [0, yaw, 0], scale: [1, 1, 1] },
    };
    await worldStore.rehydrateOne(record);
    await worldStore.saveObject(record);
    menu?.toast(`"${title}" is standing in front of you. Click it and choose ▶ Play.`, { tone: 'success', duration: 7000 });
    return true;
  }

  return { arrive, updateStage, convert };
}

// The one question before a world is replaced, asked in the app rather than with window.confirm,
// which freezes the page. Focus starts on Keep, the safe answer.
function confirmReplace(title) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'stages3d-confirm';
    back.innerHTML = `<div class="stages3d-confirm-box" role="dialog" aria-modal="true">
      <h2>Bring in your Stages project?</h2>
      <p></p>
      <div class="stages3d-confirm-row"><button type="button" data-a="keep">Keep my world</button><button type="button" data-a="go" class="go">Replace it</button></div>
    </div>`;
    back.querySelector('p').textContent = `"${title}" will be put into a new world, which replaces the world you have open. Use Save World first if you want to keep this one.`;
    document.body.appendChild(back);
    const done = (v) => { back.remove(); resolve(v); };
    back.querySelector('[data-a="keep"]').addEventListener('click', () => done(false));
    back.querySelector('[data-a="go"]').addEventListener('click', () => done(true));
    back.querySelector('[data-a="keep"]').focus();
  });
}

