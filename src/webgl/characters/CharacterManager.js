import { AGENTS_CONFIG } from "./agents.config.js";
import { AgentCharacter } from "./AgentCharacter.js";
import { AGENT_RAYCAST_LAYER } from "./CharacterModel.js";
import { agentProfileManager } from "../../state/officeWorkspace.js";
import { officeEventBus, OFFICE_EVENTS } from "../../events/OfficeEventBus.js";

export class CharacterManager {
  constructor(experience, onAgentUpdate = null) {
    this.experience = experience;
    this.scene = this.experience.scene;
    this.resources = this.experience.resources;
    this.onAgentUpdate = onAgentUpdate;

    this.characters = [];
    this.characterMap = new Map();
    this.hitProxies = [];

    this.initAgents();
    this.unsubProfile = officeEventBus.on(
      OFFICE_EVENTS.AGENT_PROFILE_UPDATED,
      ({ agentId, profile }) => {
        const agent = this.getAgent(agentId);
        if (agent && profile) {
          agent.updateProfile(profile);
          this.experience?.monitorSystem?.updateAgentProfile(agentId, profile);
        }
      },
    );
  }

  initAgents() {
    AGENTS_CONFIG.forEach((baseCfg) => {
      const saved = agentProfileManager.getProfile(baseCfg.id);
      const cfg = saved ? { ...baseCfg, ...saved } : { ...baseCfg };

      const agent = new AgentCharacter(cfg, this.resources, (agentId, snap) => {
        if (this.onAgentUpdate) this.onAgentUpdate(agentId, snap);
      });
      if (agent.model) {
        this.scene.add(agent.model);
        this.characters.push(agent);
        this.characterMap.set(cfg.id, agent);
        this.experience?.monitorSystem?.updateAgentProfile(cfg.id, cfg);

        if (agent.model.userData?.hitProxy) {
          agent.model.userData.hitProxy.layers.set(AGENT_RAYCAST_LAYER);
          this.hitProxies.push(agent.model.userData.hitProxy);
        }
      }
    });
  }

  getAgent(agentId) {
    return this.characterMap.get(agentId) || null;
  }

  getAllSnapshots() {
    const snapshots = {};
    for (const agent of this.characters) {
      snapshots[agent.config.id] = agent.getSnapshot();
    }
    return snapshots;
  }

  setSelectedAgent(agentId) {
    for (const agent of this.characters) {
      agent.setSelected(agent.config.id === agentId);
    }
  }

  setBubblesVisible(visible) {
    for (const agent of this.characters) {
      agent.setBubbleVisible(visible);
    }
  }

  update(delta) {
    for (let i = 0; i < this.characters.length; i++) {
      this.characters[i].update(delta, this.characters);
    }
  }

  destroy() {
    this.unsubProfile?.();
    this.unsubProfile = null;
    for (const agent of this.characters) {
      agent.destroy();
    }
    this.characters = [];
    this.characterMap.clear();
    this.hitProxies = [];
  }
}
