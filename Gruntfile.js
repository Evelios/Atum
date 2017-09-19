/**
 * This is for the Grunt task runner which is used as a development tool.
 */

module.exports = function(grunt) {
    "use strict";

    require("load-grunt-tasks")(grunt);
    require("load-grunt-config")(grunt);

    grunt.initConfig({
        pkg: grunt.file.readJSON("package.json"),

        // ---- Grunt Uglify Task ----
        uglify: {
            src: "build/Atum.js",
            dest: "build/Atum.min.js"
        },

        // ---- Grunt Browserify Task ----
        browserify: {
            vendor: {
                src: ["."],
                dist: "build/libs.js",
                options: {
                    debug: false,
                    alias: [

                    ],
                }
            },
            build: {
                files: {
                    "build/Atum.js": "src/main.js"
                },
                options: {
                    transform: [
                        ["babelify", { presets: "es2015" }]
                    ],
                    browserifyOptions: {
                        debug: true
                    }
                }
            },
            test: {
                files: {
                    "test/test.build.js": "test/test.js"
                },
                options: {
                    transform: [
                        ["babelify", { presets: "es2015" }]
                    ],
                    browserifyOptions: {
                        debug: true
                    }
                }
            }
        },

        // ---- Grunt Watch Task ----
        watch: {
            options: {
                livereload: true
            },
            js: {
                files: ["src/**/*.js"],
                tasks: ["browserify:dev"]
            },
            libs: {
                files: ["node_modules/**/*.js"],
                tasks: ["browserify:vendor"]
            }
        },

        // ---- Grunt JSDoc Taks ----
        jsdoc: {
            dist: {
                src: ["src/**/*.js"],
                options: {
                    destination: "doc"
                        // template :
                        // configure : 
                }
            }
        }
    });

    // ---- Load Tasks ----
    grunt.loadNpmTasks("grunt-contrib-uglify");
    grunt.loadNpmTasks("grunt-contrib-watch");
    grunt.loadNpmTasks('grunt-browserify');
    grunt.loadNpmTasks('grunt-jsdoc');

    // ---- Register Tasks ----
    grunt.registerTask("default", [
        "browserify:vendor",
        "browserify:build",
        "watch"
    ]);
    grunt.registerTask("libs", ["browserify:vendor"]);
    grunt.registerTask("build", ["browserify:build"]);
    // grunt.registerTask("build", ["browserify:vendor", "browserify:build"]);
    grunt.registerTask("test", ["browserify:build", "browserify:test"]);
    grunt.registerTask("watch", ["watch"]);
    grunt.registerTask("docs", ["jsdoc"]);

};