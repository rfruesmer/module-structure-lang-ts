import ClassA from "./package-a/module-a";
import * as moduleB from "./package-a/module-b";
import {ClassC} from "./package-a/module-c";
import {ClassD as Foo} from "./package-b/module-d";
import {ClassE1, ClassE2} from "./package-b/module-e";
import {ClassF1, ClassF2 as ClassF42} from "./package-b/module-f";
import ClassG1, { ClassG2 } from "./package-b/package-b2/module-g";
import ClassH1, * as moduleH from "./package-b/package-b2/module-h";
import ClassI1 from "./package-b/package-b2/module-i";
import moduleJ = require('./package-b/package-b2/module-j');
import vuetify from "@/plugins/vuetify";
import App from "@/package-a/App.component.vue";

