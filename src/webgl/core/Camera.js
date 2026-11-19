import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const DEFAULT_CAM_POS = new THREE.Vector3(25.0, 26.0, 25.0);
const DEFAULT_TARGET = new THREE.Vector3(0, 1.0, 0);
const _offsetDir = new THREE.Vector3();
const _desiredCamPos = new THREE.Vector3();

export class Camera {
  constructor(experience, { onViewChange = null } = {}) {
    this.experience = experience;
    this.sizes = experience.sizes;
    this.scene = experience.scene;
    this.canvas = experience.canvas;
    this.onViewChange = onViewChange;

    this.followAgentRef = null;
    this.transitionTarget = new THREE.Vector3();
    this.transitionCamPos = new THREE.Vector3();
    this.hasTransitionTarget = false;
    this.hasTransitionCamPos = false;
    this.isTransitioning = false;
    this._lastAtOverview = true;

    this.setInstance();
    this.setControls();
  }

  isAtOverview() {
    if (this.followAgentRef) return false;
    const camDistSq = this.instance.position.distanceToSquared(DEFAULT_CAM_POS);
    const targetDistSq = this.controls.target.distanceToSquared(DEFAULT_TARGET);
    return camDistSq < 0.35 && targetDistSq < 0.25;
  }

  _notifyViewStateIfChanged(forceValue = null) {
    const atOverview = forceValue !== null ? Boolean(forceValue) : this.isAtOverview();
    if (atOverview !== this._lastAtOverview) {
      this._lastAtOverview = atOverview;
      this.onViewChange?.(atOverview);
    }
  }

  setInstance() {
    this.instance = new THREE.PerspectiveCamera(
      26,
      this.sizes.width / this.sizes.height,
      0.5,
      160,
    );
    this.instance.position.copy(DEFAULT_CAM_POS);
    this.scene.add(this.instance);
  }

  setControls() {
    this.controls = new OrbitControls(this.instance, this.canvas);
    this.controls.enableDamping = !this.experience.renderer?.isSoftwareGl;
    this.controls.dampingFactor = 0.06;
    this.controls.target.copy(DEFAULT_TARGET);

    this.controls.maxPolarAngle = Math.PI / 2.25;
    this.controls.minDistance = 6.5;
    this.controls.maxDistance = 65.0;

    this.onControlsStart = () => {
      // Ceder el control al usuario inmediatamente cuando interactúa
      this.isTransitioning = false;
      this.followAgentRef = null;
      this._notifyViewStateIfChanged(false);
    };
    this.onControlsChange = () => {
      if (!this.isTransitioning && !this.followAgentRef) {
        this._notifyViewStateIfChanged();
      }
    };
    this.controls.addEventListener("start", this.onControlsStart);
    this.controls.addEventListener("change", this.onControlsChange);
  }

  focusOnAgent(agent, desiredDistance = 12.5) {
    if (!agent?.model) return;
    this.followAgentRef = agent;

    const pos = agent.model.position;
    this.transitionTarget.set(pos.x, pos.y + 0.9, pos.z);
    this.hasTransitionTarget = true;

    _offsetDir.subVectors(this.instance.position, this.controls.target);
    if (_offsetDir.lengthSq() < 0.01) {
      _offsetDir.set(1, 0.9, 1);
    }
    _offsetDir.normalize();

    const currentDist = this.instance.position.distanceTo(this.controls.target);
    const targetDist = Math.min(currentDist, desiredDistance);
    _desiredCamPos
      .copy(this.transitionTarget)
      .addScaledVector(_offsetDir, Math.max(targetDist, 8.5));
    this.transitionCamPos.copy(_desiredCamPos);
    this.hasTransitionCamPos = true;

    this.isTransitioning = true;
    this._notifyViewStateIfChanged(false);
  }

  resetView() {
    this.followAgentRef = null;
    this.transitionTarget.copy(DEFAULT_TARGET);
    this.transitionCamPos.copy(DEFAULT_CAM_POS);
    this.hasTransitionTarget = true;
    this.hasTransitionCamPos = true;
    this.isTransitioning = true;
    this._notifyViewStateIfChanged(true);
  }

  resize() {
    this.instance.aspect = this.sizes.width / this.sizes.height;
    this.instance.updateProjectionMatrix();
  }

  update(delta = 0.016) {
    const dt = Math.min(delta, 0.05);

    if (this.followAgentRef?.model) {
      const pos = this.followAgentRef.model.position;
      this.controls.target.x = THREE.MathUtils.damp(
        this.controls.target.x,
        pos.x,
        5.5,
        dt,
      );
      this.controls.target.y = THREE.MathUtils.damp(
        this.controls.target.y,
        pos.y + 0.9,
        5.5,
        dt,
      );
      this.controls.target.z = THREE.MathUtils.damp(
        this.controls.target.z,
        pos.z,
        5.5,
        dt,
      );
    } else if (this.isTransitioning && this.hasTransitionTarget) {
      this.controls.target.x = THREE.MathUtils.damp(
        this.controls.target.x,
        this.transitionTarget.x,
        6.0,
        dt,
      );
      this.controls.target.y = THREE.MathUtils.damp(
        this.controls.target.y,
        this.transitionTarget.y,
        6.0,
        dt,
      );
      this.controls.target.z = THREE.MathUtils.damp(
        this.controls.target.z,
        this.transitionTarget.z,
        6.0,
        dt,
      );
    }

    if (this.isTransitioning && this.hasTransitionCamPos) {
      this.instance.position.x = THREE.MathUtils.damp(
        this.instance.position.x,
        this.transitionCamPos.x,
        5.0,
        dt,
      );
      this.instance.position.y = THREE.MathUtils.damp(
        this.instance.position.y,
        this.transitionCamPos.y,
        5.0,
        dt,
      );
      this.instance.position.z = THREE.MathUtils.damp(
        this.instance.position.z,
        this.transitionCamPos.z,
        5.0,
        dt,
      );

      if (this.instance.position.distanceTo(this.transitionCamPos) < 0.08) {
        this.isTransitioning = false;
      }
    }

    this.controls.update();
  }

  destroy() {
    this.controls.removeEventListener("start", this.onControlsStart);
    this.controls.removeEventListener("change", this.onControlsChange);
    this.controls.dispose();
  }
}
