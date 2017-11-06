# Learning the Basics of Atum

### Introduction
Atum is a graph based library so most of the functionality revolves around those ideas. That being said I wanted to create the library to be as agnostic or generic in application as much as possible. This generality may be a boon or not but it is the approach that I am taking to try to promote as much procedural content as possible.

### A Note About ES6 vs ES5 Standards

If you are unfamiliar of what ES6 is, the quick explination is that it is new programming standards and syntax that is rolling out for javascript. Although this wave is slow to roll out. That being said, my libary is written so that it can use the full benefits of these new standards. Although to keep up backwards compatability I deliver all my modules to be used in the ES5 format so that no one is missing out on the wonderful benefits of what this libary has to offer. This should have no effect as a user but might be an interesting tidbit to consider.

## 1. Getting Started

To include the package into your library all you have to do is

```bash
# Assuming that you are using node package manager
npm install Atum

# Otherwise just download the source from github
https://github.com/Evelios/Atum
```
When you have the source code you can then use it in your project. This project is build so that you can user it either on the server side with Node.js or you can include the script file into your HTML to use it like most standard libraries by acessing the Atum library as a global variable.

### Using Require Tags With Node.js

This package is built to use the AMD style require tags, which is the standard that is used within the Node environment. To include that package you can simply do

```js
// Create a Locally Scoped Atum variable
var Atum = require('Atum');     

var vector = new Atum.Geometry.Vector(5, 7);
```

Now you have access to the Atum library and you have used it to create a **vector** object.

### Including Atum in an HTML Document

You can include the file into your HTML document directly with the Atum variable being globally available in the script you are trying to write.

```html
<html>
<head>

    <!-- Include the Atum library -->
    <script src='./path-to-Atum/Atum.js'></script>

    <!-- You scripting goes here -->
    <script>
        // Now we can simply access the included globaly scoped Atum variable
        var vector = new Atum.Geometry.Vector(5, 7);
    </script>

</head>
</html>
```

That was everything included in a single file which is simple for explination but in practice you will have the js code in a seperate file. In which case you would do something more along the lines of,

*index.html*
```html
<html>
<head>

    <script src='./path-to-Atum/Atum.js'></script>
    <script src='./script.js'></script>

</head>
</html>
```

*script.js*
```js
// The library's global variable Atum is still available to use here
var vector = new Atum.Geometry.Vector(5, 7);
```

Now that you have been able to include the script tag, from here on out I am going to assume that the Atum global variable is included in your script somehow.

## 2. Library Structure



## 3. Creating a Diagram