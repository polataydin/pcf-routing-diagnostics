import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { App } from "./components/App";

export class RoutingDiagnostics
  implements ComponentFramework.ReactControl<IInputs, IOutputs>
{
  private context!: ComponentFramework.Context<IInputs>;

  public init(context: ComponentFramework.Context<IInputs>): void {
    this.context = context;
    // The control queries Dataverse itself rather than reading the bound dataset,
    // so it needs the full width the page can give it.
    context.mode.trackContainerResize(true);
  }

  public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
    this.context = context;
    return React.createElement(App, {
      webAPI: context.webAPI,
      navigation: context.navigation,
      isDarkTheme: isDarkTheme(context),
    });
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {
    // React teardown is handled by the platform for virtual controls.
  }
}

/** Model-driven apps expose the theme through fluentDesignLanguage when the host
 *  supports it; older hosts do not, and light is the safe default there. */
function isDarkTheme(context: ComponentFramework.Context<IInputs>): boolean {
  const design = (context as unknown as {
    fluentDesignLanguage?: { isDarkTheme?: boolean };
  }).fluentDesignLanguage;
  return design?.isDarkTheme === true;
}