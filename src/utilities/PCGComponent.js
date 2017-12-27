class PCGComponent {
    /**
     * This is an abstract base class for all the PCG components. The purpose of
     * this class is to be something that can be easily extened upon without
     * stepping on any of the extended objects. This class is supposed to be
     * used so that classes
     * 
     * @property {object} data The data object that stores all the information
     *  inside the PCD Component. Having this information isolated to its own
     *  component allows the component to be easily resused and extended off of.
     *  This is intended to be applied to all objects in the PCG library so that
     *  every object is easily extendable as well
     * 
     * @abstract
     * @class PCGComponent
     */
    constructor() {
        this.data = {};
    }

    getData() {
        return this.data;
    }

    // https://stackoverflow.com/questions/12534238/updating-javascript-object-attributes-from-another-object
    // Is this the start of _lodash?
    _setObj(updates, obj) {

    }

    setData(input) {

    }
}

export default PCGComponent;