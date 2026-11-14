# Documentation

English | [繁體中文](zh-TW/README.md)

These guides explain what the plugin does and why it is built the way it is.
The [main README](../README.md) is the reference: installation, every
configuration key, the permission table and the extension APIs. The guides
link to it instead of repeating it.

| Guide                                                            | Read it when                                                                                                                                                   | For                                                 |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| [Temporal primer](temporal-primer.md)                            | You have not used Temporal, or want the vocabulary before you open the plugin.                                                                                 | Anyone new to Temporal                              |
| [From Temporal concepts to the plugin](concepts-to-plugin.md)    | You know a Temporal concept and want to find it on a screen or in the configuration, or want to know what the plugin adds.                                     | Everyone                                            |
| [How it works](how-it-works.md)                                  | You want to follow a request from the browser to Temporal, or a Scaffolder run from start to finish, and see where permission checks and audit records happen. | Platform engineers who install or extend the plugin |
| [Architecture](architecture.md)                                  | You are deciding which packages to install, writing a backend module or a permission policy, or contributing.                                                  | Platform engineers, contributors                    |
| [The plugin and the Temporal Web UI](compared-to-temporal-ui.md) | You wonder whether you still need the Temporal Web UI, or which one to use for a task.                                                                         | Everyone                                            |
| [Public interfaces](public-interfaces.md)                        | You install the plugin, extend it with a module, or call it from other code, and want every interface you can rely on, with examples.                          | Integrators, module authors                         |
| [Walkthrough](walkthrough.md)                                    | You want to see every screen and operation on your own machine, with the example worker of this repository.                                                    | Everyone; about two hours                           |

A good order for a first read: the primer, the concepts guide, then the
walkthrough. Read "How it works" and "Architecture" before you change or
extend the plugin, and "Public interfaces" before you build on it.

The diagrams are SVG files in [`images/`](images/). Screenshots are shared
with the README.
