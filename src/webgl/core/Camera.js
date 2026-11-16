import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const DEFAULT_CAM_POS = new THREE.Vector3(25.0, 26.0, 25.0);
const DEFAULT_TARGET = new THREE.Vector3(0, 1.0, 0);
const _offsetDir = new THREE.Vector3();
const _desiredCamPos = new THREE.Vector3();

export class Camera {
  constructor(experience) {
    this.experience = experience;
    this.sizes = experience.sizes;
    this.scene = experience.scene;
    this.canvas = experience.canvas;

    this.followAgentRef = null;
    this.transitionTarget = null;
    this.transitionCamPos = null;
    this.isTransitioning = false;

    this.setInstance();
    this.setControls();
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
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.target.copy(DEFAULT_TARGET);

    this.controls.maxPolarAngle = Math.PI / 2.25;
    this.controls.minDistance = 6.5;
    this.controls.maxDistance = 65.0;

    this.onControlsStart = () => {
      // Ceder el control al usuario inmediatamente cuando interactúa
      this.isTransitioning = false;
      this.followAgentRef = null;
    };
    this.controls.addEventListener("start", this.onControlsStart);
  }

  focusOnAgent(agent, desiredDistance = 12.5) {
    if (!agent?.model) return;
    this.followAgentRef = agent;

    const pos = agent.model.position;
    this.transitionTarget = new THREE.Vector3(pos.x, pos.y + 0.9, pos.z);

    _offsetDir.subVectors(this.instance.position, this.controls.target);
    if (_offsetDir.lengthSq() < 0.01) {
      _offsetDir.set(1, 0.9, 1);
    }
    _offsetDir.normalize();

    const currentDist = this.instance.position.distanceTo(this.controls.target);
    const targetDist = Math.min(currentDist, desiredDistance);
    this.transitionCamPos = _desiredCamPos
      .copy(this.transitionTarget)
      .addScaledVector(_offsetDir, Math.max(targetDist, 8.5))
      .clone();

    this.isTransitioning = true;
  }

  resetView() {
    this.followAgentRef = null;
    this.transitionTarget = DEFAULT_TARGET.clone();
    this.transitionCamPos = DEFAULT_CAM_POS.clone();
    this.isTransitioning = true;
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
    } else if (this.isTransitioning && this.transitionTarget) {
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

    if (this.isTransitioning && this.transitionCamPos) {
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
    this.controls.dispose();
  }
}
