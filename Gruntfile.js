/**
 * This is for the Grunt task runner which is used as a development tool.
 */

module.exports = function(grunt) {
    "use strict";

    // ---- Require Tasks ----
    require("load-grunt-tasks")(grunt);
    require("load-grunt-config")(grunt);

    // ---- Load Tasks ----
    grunt.loadNpmTasks("grunt-contrib-uglify");
    grunt.loadNpmTasks("grunt-contrib-watch");
    grunt.loadNpmTasks('grunt-browserify');
    grunt.loadNpmTasks('grunt-jsdoc');

    grunt.initConfig({
        pkg: grunt.file.readJSON("package.json"),

        // ---- Grunt Browserify Task ----
        browserify: {
            build: {
                files: {
                    "./build/Atum.js": "./src/main.js"
                },
                options: {
                    transform: [
                        ["babelify", {
                            presets: "es2015",
                            "plugins": [
                                "add-module-exports", ["babel-plugin-transform-builtin-extend", {
                                    globals: ["Error", "Array"]
                                }]
                            ]
                        }]
                    ],
                    browserifyOptions: {
                        standalone: "Atum",
                    },
                },
            },
            dev: {
                files: {
                    "./build/Atum.js": "./src/main.js"
                },
                options: {
                    transform: [
                        ["babelify", {
                            presets: "es2015",
                            "plugins": [
                                "add-module-exports", ["babel-plugin-transform-builtin-extend", {
                                    globals: ["Error", "Array"]
                                }]
                            ]
                        }]
                    ],
                    watch: true,
                    keepAlive: true,
                    browserifyOptions: {
                        standalone: "Atum",
                        debug: true
                    },
                },
            },
        },

        // ---- Grunt Watch Task ----
        watch: {
            js: {
                files: ["./build/Atum.js"],
                tasks: [""],
            },
        },

        // ---- Grunt JSDoc Taks ----
        jsdoc: {
            dist: {
                src: ["src/**/*.js"],
                options: {
                    title: "Atum",
                    verbose: true,
                    // package: "package.json", // Use to track documentation changes
                    // configure: "jsdoc.json",
                    readme: "README.md",
                    // tutorials: "tutorials", // Not currently working with jaguarjs
                    destination: "docs",
                    // There is the option of using jaguarjs-jsdoc-patched-2
                    template: "./node_modules/jaguarjs-jsdoc-patched",
                    // template: "node_modules/tui-jsdoc-template/", // This is the goal
                    recurse: true,
                }
            }
        },

        // ---- Grunt Uglify Task ----
        uglify: {
            js: {
                src: "build/Atum.js",
                dest: "build/Atum.min.js"
            }
        }
    });

    // ---- Register Tasks ----
    grunt.registerTask("default", [
        "browserify:vendor",
        "browserify:build",
        "watch"
    ]);

    grunt.registerTask("dev", ["browserify:dev"]);
    grunt.registerTask("build", ["browserify:build", "uglify", "jsdoc"]);
    grunt.registerTask("test", ["browserify:build", "browserify:test"]);
    grunt.registerTask("watch", ["browserify:build", "watch:js"]);
    grunt.registerTask("docs", ["jsdoc"]);

};