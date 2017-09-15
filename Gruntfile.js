/**
 * This is for the Grunt task runner which is used as a development tool.
 */

module.exports = function(grunt) {
    "use strict";

    require("load-grunt-tasks")(grunt);

    grunt.initConfig({
        pkg: grunt.file.readJSON("package.json"),

        uglify: {
            src: "build/Atum.js",
            dest: "build/Atum.min.js"
        },

        browserify: {
            dist: {
                files: {
                    "build/Atum.js": "src/main.js"
                },
                options: {
                    transform: [
                        ["babelify", { presets: "es2015" }]
                    ],
                    browserifyOptions: {
                        deebug: true
                    }
                }
            },
            dev: {
                files: {
                    "build/Atum.js": "src/main.js"
                },
                options: {
                    transform: [
                        ["babelify", { presets: "es2015" }]
                    ],
                    browserifyOptions: {
                        deebug: true
                    }
                }
            }
        },

        watch: {
            js: {
                files: ["src/*.js"],
                tasks: ["browserify:dev"]
            }
        }
    });

    grunt.loadNpmTasks("grunt-contrib-uglify");
    grunt.loadNpmTasks("grunt-contrib-watch");

    grunt.registerTask("default", []);
    grunt.registerTask("build", ["browserify:dist", "uglify"]);
    grunt.registerTask("watch", ["watch"]);

}