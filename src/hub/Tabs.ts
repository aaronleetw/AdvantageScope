import { TabsState } from "../shared/HubState";
import TabType, { getDefaultTabTitle, getTabIcon } from "../shared/TabType";
import LineGraphRenderer from "../shared/renderers/LineGraphRenderer";
import NoopRenderer from "../shared/renderers/NoopRenderer";
import TabRenderer from "../shared/renderers/TabRenderer";
import { UnitConversionPreset } from "../shared/units";
import ScrollSensor from "./ScrollSensor";
import Timeline from "./Timeline";
import LineGraphController from "./controllers/LineGraphController";
import NoopController from "./controllers/NoopController";
import TabController from "./controllers/TabController";

export default class Tabs {
  private VIEWER = document.getElementsByClassName("viewer")[0] as HTMLElement;
  private TIMELINE_CONTAINER = document.getElementsByClassName("timeline")[0] as HTMLElement;
  private TAB_BAR = document.getElementsByClassName("tab-bar")[0];
  private SHADOW_LEFT = document.getElementsByClassName("tab-bar-shadow-left")[0] as HTMLElement;
  private SHADOW_RIGHT = document.getElementsByClassName("tab-bar-shadow-right")[0] as HTMLElement;
  private SCROLL_OVERLAY = document.getElementsByClassName("tab-bar-scroll")[0] as HTMLElement;

  private RENDERER_CONTENT = document.getElementsByClassName("renderer-content")[0] as HTMLElement;
  private CONTROLS_CONTENT = document.getElementsByClassName("controls-content")[0] as HTMLElement;
  private CONTROLS_HANDLE = document.getElementsByClassName("controls-handle")[0] as HTMLElement;

  private LEFT_BUTTON = document.getElementsByClassName("move-left")[0] as HTMLElement;
  private RIGHT_BUTTON = document.getElementsByClassName("move-right")[0] as HTMLElement;
  private CLOSE_BUTTON = document.getElementsByClassName("close")[0] as HTMLElement;
  private ADD_BUTTON = document.getElementsByClassName("add-tab")[0] as HTMLElement;

  private TAB_CONFIGS: Map<TabType, { showTimeline: boolean; showControls: boolean }> = new Map();

  private tabsScrollSensor: ScrollSensor;
  private timeline: Timeline;

  private tabList: {
    type: TabType;
    title: string;
    titleElement: HTMLElement;
    controlsElement: HTMLElement;
    rendererElement: HTMLElement;
    controller: TabController;
    renderer: TabRenderer;
  }[] = [];
  private selectedTab = 0;
  private controlsHandleActive = false;
  private controlHeight = 200;

  constructor() {
    // Set up tab configs
    this.TAB_CONFIGS.set(TabType.Documentation, { showTimeline: false, showControls: false });
    this.TAB_CONFIGS.set(TabType.LineGraph, { showTimeline: false, showControls: true });
    this.TAB_CONFIGS.set(TabType.Table, { showTimeline: false, showControls: false });
    this.TAB_CONFIGS.set(TabType.Console, { showTimeline: false, showControls: false });
    this.TAB_CONFIGS.set(TabType.Statistics, { showTimeline: false, showControls: false });
    this.TAB_CONFIGS.set(TabType.Odometry, { showTimeline: true, showControls: true });
    this.TAB_CONFIGS.set(TabType.ThreeDimension, { showTimeline: true, showControls: true });
    this.TAB_CONFIGS.set(TabType.Video, { showTimeline: true, showControls: true });
    this.TAB_CONFIGS.set(TabType.Joysticks, { showTimeline: true, showControls: true });
    this.TAB_CONFIGS.set(TabType.Swerve, { showTimeline: true, showControls: true });
    this.TAB_CONFIGS.set(TabType.Mechanism, { showTimeline: true, showControls: true });
    this.TAB_CONFIGS.set(TabType.Points, { showTimeline: true, showControls: true });
    this.TAB_CONFIGS.set(TabType.Metadata, { showTimeline: false, showControls: false });

    // Hover and click handling
    this.SCROLL_OVERLAY.addEventListener("click", (event) => {
      this.tabList.forEach((tab, index) => {
        let rect = tab.titleElement.getBoundingClientRect();
        if (
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom
        ) {
          this.setSelected(index);
        }
      });
    });
    this.SCROLL_OVERLAY.addEventListener("contextmenu", (event) => {
      this.tabList.forEach((tab, index) => {
        if (index === 0) return;
        let rect = tab.titleElement.getBoundingClientRect();
        if (
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom
        ) {
          window.sendMainMessage("ask-rename-tab", {
            index: index,
            name: this.tabList[index].title
          });
        }
      });
    });
    this.SCROLL_OVERLAY.addEventListener("mousemove", (event) => {
      this.tabList.forEach((tab) => {
        let rect = tab.titleElement.getBoundingClientRect();
        if (
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom
        ) {
          tab.titleElement.classList.add("tab-hovered");
        } else {
          tab.titleElement.classList.remove("tab-hovered");
        }
      });
    });
    this.SCROLL_OVERLAY.addEventListener("mouseout", () => {
      this.tabList.forEach((tab) => {
        tab.titleElement.classList.remove("tab-hovered");
      });
    });

    // Controls handle
    this.CONTROLS_HANDLE.addEventListener("mousedown", () => {
      this.controlsHandleActive = true;
      document.body.style.cursor = "row-resize";
    });
    window.addEventListener("mouseup", () => {
      this.controlsHandleActive = false;
      document.body.style.cursor = "initial";
    });
    window.addEventListener("mousemove", (event) => {
      if (this.controlsHandleActive) {
        let height = window.innerHeight - event.clientY;
        if (height >= 30 && height < 100) height = 100;
        if (height < 30) height = 0;
        this.controlHeight = height;
        this.updateControlsHeight();
      }
    });
    this.updateControlsHeight();

    // Control buttons
    this.LEFT_BUTTON.addEventListener("click", () => this.shift(this.selectedTab, -1));
    this.RIGHT_BUTTON.addEventListener("click", () => this.shift(this.selectedTab, 1));
    this.CLOSE_BUTTON.addEventListener("click", () => this.close(this.selectedTab));
    this.ADD_BUTTON.addEventListener("click", () => {
      window.sendMainMessage("ask-new-tab");
    });

    // Add default tabs
    this.addTab(TabType.Documentation);
    this.addTab(TabType.LineGraph);

    // Scroll management
    this.tabsScrollSensor = new ScrollSensor(this.SCROLL_OVERLAY, (dx: number, dy: number) => {
      this.TAB_BAR.scrollLeft += dx + dy;
    });

    // Add timeline
    this.timeline = new Timeline(this.TIMELINE_CONTAINER);

    // Periodic function
    let periodic = () => {
      this.SHADOW_LEFT.style.opacity = Math.floor(this.TAB_BAR.scrollLeft) <= 0 ? "0" : "1";
      this.SHADOW_RIGHT.style.opacity =
        Math.ceil(this.TAB_BAR.scrollLeft) >= this.TAB_BAR.scrollWidth - this.TAB_BAR.clientWidth ? "0" : "1";
      this.tabsScrollSensor.periodic();
      this.timeline.periodic();
      this.updateControlsHeight();
      window.requestAnimationFrame(periodic);
    };
    window.requestAnimationFrame(periodic);
  }

  private updateControlsHeight() {
    let availableHeight = window.innerHeight - this.RENDERER_CONTENT.getBoundingClientRect().top;
    availableHeight -= 150;
    this.controlHeight = Math.min(this.controlHeight, availableHeight);

    let appliedHeight = this.controlHeight;
    let selectedTab = this.tabList[this.selectedTab];
    if (selectedTab) {
      let tabConfig = this.TAB_CONFIGS.get(selectedTab.type);
      let controlsHidden = tabConfig !== undefined && !tabConfig.showControls;
      if (controlsHidden) {
        appliedHeight = 0;
      }
      this.CONTROLS_HANDLE.hidden = controlsHidden;
    }
    document.documentElement.style.setProperty("--tab-controls-height", appliedHeight.toString() + "px");
    document.documentElement.style.setProperty("--show-tab-controls", appliedHeight > 0 ? "1" : "0");
    this.CONTROLS_CONTENT.hidden = appliedHeight === 0;
  }

  /** Returns the current state. */
  saveState(): TabsState {
    return {
      selected: this.selectedTab,
      controlsHeight: this.controlHeight,
      tabs: this.tabList.map((tab) => {
        return {
          type: tab.type,
          title: tab.title,
          controller: tab.controller.saveState(),
          renderer: tab.renderer.saveState()
        };
      })
    };
  }

  /** Restores to the provided state. */
  restoreState(state: TabsState) {
    this.tabList.forEach((tab) => {
      this.RENDERER_CONTENT.removeChild(tab.rendererElement);
      this.CONTROLS_CONTENT.removeChild(tab.controlsElement);
    });
    this.tabList = [];
    this.selectedTab = 0;
    state.tabs.forEach((tabState, index) => {
      this.addTab(tabState.type);
      if (tabState.title) this.renameTab(index, tabState.title);
      this.tabList[index].controller.restoreState(tabState.controller);
      this.tabList[index].renderer.restoreState(tabState.renderer);
    });
    this.selectedTab = state.selected >= this.tabList.length ? this.tabList.length - 1 : state.selected;
    this.updateElements();

    this.controlHeight = state.controlsHeight;
    this.updateControlsHeight();
  }

  /** Refresh based on new log data. */
  refresh() {
    this.tabList.forEach((tab) => {
      tab.controller.refresh();
    });
  }

  /** Refresh based on a new set of assets. */
  newAssets() {
    this.tabList.forEach((tab) => {
      tab.controller.newAssets();
    });
  }

  /** Returns the set of fields currently being displayed. */
  getActiveFields(): Set<string> {
    let activeFields = new Set<string>();
    this.tabList.forEach((tab) => {
      tab.controller.getActiveFields().forEach((field) => {
        activeFields.add(field);
      });
    });
    return activeFields;
  }

  /** Creates a new tab. */
  addTab(type: TabType) {
    // Select existing metadata tab
    if (type === TabType.Metadata) {
      let existingIndex = this.tabList.findIndex((tab) => tab.type === TabType.Metadata);
      if (existingIndex >= 0) {
        this.setSelected(existingIndex);
        return;
      }
    }

    // Add tab
    let controlsElement = document.getElementById("controller" + type.toString())?.cloneNode(true) as HTMLElement;
    let rendererElement = document.getElementById("renderer" + type.toString())?.cloneNode(true) as HTMLElement;
    controlsElement.removeAttribute("id");
    rendererElement.removeAttribute("id");
    let controller: TabController;
    let renderer: TabRenderer;
    switch (type) {
      case TabType.LineGraph:
        controller = new LineGraphController(controlsElement);
        renderer = new LineGraphRenderer();
        break;
      default:
        controller = new NoopController();
        renderer = new NoopRenderer();
        break;
    }

    // Create title element
    let titleElement = document.createElement("div");
    titleElement.classList.add("tab");
    titleElement.innerText = getTabIcon(type) + " " + getDefaultTabTitle(type);

    // Save to tab list
    if (this.tabList.length === 0) {
      this.selectedTab = -1;
    }
    this.tabList.splice(this.selectedTab + 1, 0, {
      type: type,
      title: getDefaultTabTitle(type),
      titleElement: titleElement,
      controlsElement: controlsElement,
      rendererElement: rendererElement,
      controller: controller,
      renderer: renderer
    });
    this.selectedTab += 1;
    this.CONTROLS_CONTENT.appendChild(controlsElement);
    this.RENDERER_CONTENT.appendChild(rendererElement);
    controller.periodic(); // Some controllers need to initialize by running a periodic cycle while visible
    this.updateElements();
  }

  /** Closes the specified tab. */
  close(index: number) {
    if (index < 1 || index > this.tabList.length - 1) return;
    this.RENDERER_CONTENT.removeChild(this.tabList[index].rendererElement);
    this.CONTROLS_CONTENT.removeChild(this.tabList[index].controlsElement);
    this.tabList.splice(index, 1);
    if (this.selectedTab > index) this.selectedTab--;
    if (this.selectedTab > this.tabList.length - 1) this.selectedTab = this.tabList.length - 1;
    this.updateElements();
  }

  /** Returns the index of the selected tab. */
  getSelectedTab(): number {
    return this.selectedTab;
  }

  /** Changes which tab is currently selected. */
  setSelected(index: number) {
    if (index < 0 || index > this.tabList.length - 1) return;
    this.selectedTab = index;
    this.updateElements();
  }

  /** Moves the specified tab left or right. */
  shift(index: number, shift: number) {
    if (index === 0) return;
    if (index + shift < 1) shift = 1 - index;
    if (index + shift > this.tabList.length - 1) shift = this.tabList.length - 1 - index;
    if (this.selectedTab === index) this.selectedTab += shift;

    let tab = this.tabList.splice(index, 1)[0];
    this.tabList.splice(index + shift, 0, tab);
    this.updateElements();
  }

  /** Renames a single tab. */
  renameTab(index: number, name: string) {
    let tab = this.tabList[index];
    tab.title = name;
    tab.titleElement.innerText = getTabIcon(tab.type) + " " + name;
  }

  /** Adds the enabled field to the discrete legend on the selected line graph. */
  addDiscreteEnabled() {
    if (this.tabList[this.selectedTab].type === TabType.LineGraph) {
      // (this.tabList[this.selectedTab].controller as LineGraphController).addDiscreteEnabled();
    }
  }

  /** Adjusts the locked range and unit conversion for an axis on the selected line graph. */
  editAxis(legend: string, lockedRange: [number, number] | null, unitConversion: UnitConversionPreset) {
    if (this.tabList[this.selectedTab].type === TabType.LineGraph) {
      // (this.tabList[this.selectedTab].controller as LineGraphController).editAxis(legend, lockedRange, unitConversion);
    }
  }

  /** Clear the fields for an axis on the selected line graph. */
  clearAxis(legend: string) {
    if (this.tabList[this.selectedTab].type === TabType.LineGraph) {
      // (this.tabList[this.selectedTab].controller as LineGraphController).clearAxis(legend);
    }
  }

  /** Switches the selected camera for the selected 3D field. */
  set3DCamera(index: number) {
    if (this.tabList[this.selectedTab].type === TabType.ThreeDimension) {
      // (this.tabList[this.selectedTab].controller as ThreeDimensionController).set3DCamera(index);
    }
  }

  /** Switches the orbit FOV for the selected 3D field. */
  setFov(fov: number) {
    if (this.tabList[this.selectedTab].type === TabType.ThreeDimension) {
      // (this.tabList[this.selectedTab].controller as ThreeDimensionController).setFov(fov);
    }
  }

  /** Returns whether the selected tab is a video which
   * is unlocked (and thus requires access to the left
   * and right arrow keys) */
  isUnlockedVideoSelected(): boolean {
    if (this.tabList[this.selectedTab].type === TabType.Video) {
      // return !(this.tabList[this.selectedTab].controller as VideoController).isLocked();
      return false;
    } else {
      return false;
    }
  }

  /** Sends video data to all video controllers. */
  processVideoData(data: any) {
    this.tabList.forEach((tab) => {
      if (tab.type === TabType.Video) {
        // (tab.controller as VideoController).processVideoData(data);
      }
    });
  }

  /** Updates the displayed elements based on the tab list. */
  private updateElements() {
    // Remove old tabs
    while (this.TAB_BAR.firstChild) {
      this.TAB_BAR.removeChild(this.TAB_BAR.firstChild);
    }

    // Add title elements
    this.tabList.forEach((item, index) => {
      this.TAB_BAR.appendChild(item.titleElement);
      if (index === this.selectedTab) {
        item.titleElement.classList.add("tab-selected");
        item.rendererElement.hidden = false;
        item.controlsElement.hidden = false;
        let tabConfig = this.TAB_CONFIGS.get(item.type);
        if (tabConfig) {
          document.documentElement.style.setProperty("--show-timeline", tabConfig.showTimeline ? "1" : "0");
          this.TIMELINE_CONTAINER.hidden = !tabConfig.showTimeline;
        }
      } else {
        item.titleElement.classList.remove("tab-selected");
        item.rendererElement.hidden = true;
        item.controlsElement.hidden = true;
      }
    });
  }
}
