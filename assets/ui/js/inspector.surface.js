/*
 * Inspector Surface class.
 *
 * The class creates Inspector user interface and all the editors
 * corresponding to the passed configuration in a specified container
 * element.
 *
 */
+function ($) { "use strict";

    // NAMESPACES
    // ============================

    if ($.oc === undefined)
        $.oc = {}

    if ($.oc.inspector === undefined)
        $.oc.inspector = {}

    // CLASS DEFINITION
    // ============================

    var Base = $.oc.foundation.base,
        BaseProto = Base.prototype

    /**
     * Creates the Inspector surface in a container.
     * - containerElement container DOM element
     * - properties array (array of objects)
     * - values - property values, an object
     * - inspectorUniqueId - a string containing the unique inspector identifier. 
     *   The identifier should be a constant for an inspectable element. Use 
     *   $.oc.inspector.helpers.generateElementUniqueId(element) to generate a persistent ID 
     *   for an element. Use $.oc.inspector.helpers.generateUniqueId() to generate an ID
     *   not associated with an element. Inspector uses the ID for storing configuration
     *   related to an element in the document DOM.
     */
    var Surface = function(containerElement, properties, values, inspectorUniqueId, options, parentSurface, group) {
        if (inspectorUniqueId === undefined) {
            throw new Error('Inspector surface unique ID should be defined.')
        }

        this.options = $.extend({}, Surface.DEFAULTS, typeof options == 'object' && options)
        this.rawProperties = properties
        this.parsedProperties = $.oc.inspector.engine.processPropertyGroups(properties)
        this.container = containerElement
        this.inspectorUniqueId = inspectorUniqueId
        this.values = values !== null ? values : {}
        this.originalValues = $.extend(true, {}, this.values) // Clone the values hash
        this.idCounter = 1
        this.popupCounter = 0
        this.parentSurface = parentSurface

        this.editors = []
        this.externalParameterEditors = []
        this.tableContainer = null
        this.groupManager = null
        this.group = null

        if (group !== undefined) {
            this.group = group
        }

        if (!this.parentSurface) {
            this.groupManager = new $.oc.inspector.groupManager(this.inspectorUniqueId)
        }

        Base.call(this)

        this.init()
    }

    Surface.prototype = Object.create(BaseProto)
    Surface.prototype.constructor = Surface

    Surface.prototype.dispose = function() {
        this.unregisterHandlers()
        this.disposeControls()
        this.disposeEditors()
        this.removeElements()
        this.disposeExternalParameterEditors()

        this.container = null
        this.tableContainer = null
        this.rawProperties = null
        this.parsedProperties = null
        this.editors = null
        this.externalParameterEditors = null
        this.values = null
        this.originalValues = null
        this.options.onChange = null
        this.options.onPopupDisplayed = null
        this.options.onPopupHidden = null
        this.parentSurface = null
        this.groupManager = null
        this.group = null

        BaseProto.dispose.call(this)
    }

    // INTERNAL METHODS
    // ============================

    Surface.prototype.init = function() {
        if (this.groupManager && !this.group) {
            this.group = this.groupManager.createGroup('root')
        }

        this.build()

        if (!this.parentSurface) {
            $.oc.foundation.controlUtils.markDisposable(this.tableContainer)
        }

        this.registerHandlers()
    }

    Surface.prototype.registerHandlers = function() {
        if (!this.parentSurface) {
            $(this.tableContainer).one('dispose-control', this.proxy(this.dispose))
            $(this.tableContainer).on('click', 'tr.group, tr.control-group', this.proxy(this.onGroupClick))
            $(this.tableContainer).on('focus-control', this.proxy(this.focusFirstEditor))
        }
    }

    Surface.prototype.unregisterHandlers = function() {
        if (!this.parentSurface) {
            $(this.tableContainer).off('dispose-control', this.proxy(this.dispose))
            $(this.tableContainer).off('click', 'tr.group, tr.control-group', this.proxy(this.onGroupClick))
            $(this.tableContainer).off('focus-control', this.proxy(this.focusFirstEditor))
        }
    }

    //
    // Building
    //

    /**
     * Builds the Inspector table. The markup generated by this method looks 
     * like this:
     *
     * <div>
     *     <table>
     *         <tbody>
     *             <tr>
     *                 <th data-property="label">
     *                     <div>
     *                         <div>
     *                             <span class="title-element" title="Label">
     *                                 <a href="javascript:;" class="expandControl expanded" data-group-index="1">Expand/Collapse</a>
     *                                 Label
     *                             </span>
     *                         </div>
     *                     </div>
     *                 </th>
     *                 <td>
     *                     Editor markup
     *                 </td>
     *             </tr>
     *         </tbody>
     *     </table>
     * </div>
     */
    Surface.prototype.build = function() {
        this.tableContainer = document.createElement('div')

        var dataTable = document.createElement('table'),
            tbody = document.createElement('tbody')

        $.oc.foundation.element.addClass(dataTable, 'inspector-fields')
        if (this.parsedProperties.hasGroups) {
            $.oc.foundation.element.addClass(dataTable, 'has-groups')
        }

        var currentGroup = this.group

        for (var i=0, len = this.parsedProperties.properties.length; i < len; i++) {
            var property = this.parsedProperties.properties[i]

            if (property.itemType == 'group') {
                currentGroup = this.getGroupManager().createGroup(property.groupIndex, this.group)
            }
            else {
                if (property.groupIndex === undefined) {
                    currentGroup = this.group
                }
            }

            var row = this.buildRow(property, currentGroup)

            if (property.itemType == 'group')
            {
                this.applyGroupLevelToRow(row, currentGroup.parentGroup)
            }
            else {
                this.applyGroupLevelToRow(row, currentGroup)
            }

            tbody.appendChild(row)

            // Editor
            //
            this.buildEditor(row, property, dataTable, currentGroup)
        }

        dataTable.appendChild(tbody)
        this.tableContainer.appendChild(dataTable)

        this.container.appendChild(this.tableContainer)

        if (this.options.enableExternalParameterEditor) {
            this.buildExternalParameterEditor(tbody)
        }

        if (!this.parentSurface) {
            this.focusFirstEditor()
        }
    }

    Surface.prototype.moveToContainer = function(newContainer) {
        this.container = newContainer

        this.container.appendChild(this.tableContainer)
    }

    Surface.prototype.buildRow = function(property, group) {
        var row = document.createElement('tr'),
            th = document.createElement('th'),
            titleSpan = document.createElement('span'),
            description = this.buildPropertyDescription(property)

        // Table row
        //
        if (property.property) {
            row.setAttribute('data-property', property.property)
        }

        this.applyGroupIndexAttribute(property, row, group)
        $.oc.foundation.element.addClass(row, this.getRowCssClass(property, group))

        // Property head
        //
        this.applyHeadColspan(th, property)

        titleSpan.setAttribute('class', 'title-element')
        titleSpan.setAttribute('title', this.escapeJavascriptString(property.title))
        this.buildGroupExpandControl(titleSpan, property, false, false, group)

        titleSpan.innerHTML += this.escapeJavascriptString(property.title)

        var outerDiv = document.createElement('div'),
            innerDiv = document.createElement('div')

        innerDiv.appendChild(titleSpan)

        if (description) {
            innerDiv.appendChild(description)
        }

        outerDiv.appendChild(innerDiv)
        th.appendChild(outerDiv)
        row.appendChild(th)

        return row
    }

    Surface.prototype.focusFirstEditor = function() {
        if (this.editors.length == 0) {
            return
        }

        var groupManager = this.getGroupManager()

        for (var i = 0, len = this.editors.length; i < len; i++) {
            var editor = this.editors[i],
                group = editor.parentGroup

            if (group && !this.groupManager.isGroupExpanded(group) ) {
                continue
            }

            var externalParameterEditor = this.findExternalParameterEditor(editor.getPropertyName())

            if (externalParameterEditor && externalParameterEditor.isEditorVisible()) {
                externalParameterEditor.focus()
                return
            }

            editor.focus()
            return
        }
    }

    Surface.prototype.getRowCssClass = function(property, group) {
        var result = property.itemType

        if (property.itemType == 'property') {
            // result += ' grouped'
            if (group.parentGroup) {
                result += this.getGroupManager().isGroupExpanded(group) ? ' expanded' : ' collapsed'
            }
        }

        if (property.itemType == 'property' && !property.showExternalParam) {
            result += ' no-external-parameter'
        }

        return result
    }

    Surface.prototype.applyHeadColspan = function(th, property) {
        if (property.itemType == 'group') {
            th.setAttribute('colspan',  2)
        }
    }

    Surface.prototype.buildGroupExpandControl = function(titleSpan, property, force, hasChildSurface, group) {
        if (property.itemType !== 'group' && !force) {
            return
        }

        var groupIndex = this.getGroupManager().getGroupIndex(group),
            statusClass = this.getGroupManager().isGroupExpanded(group) ? 'expanded' : '',
            anchor = document.createElement('a')

        anchor.setAttribute('class', 'expandControl ' + statusClass)
        anchor.setAttribute('href', 'javascript:;')
        anchor.innerHTML = '<span>Expand/collapse</span>'

        titleSpan.appendChild(anchor)
    }

    Surface.prototype.buildPropertyDescription = function(property) {
        if (property.description === undefined || property.description === null) {
            return null
        }

        var span = document.createElement('span')
        span.setAttribute('title', this.escapeJavascriptString(property.description))
        span.setAttribute('class', 'info oc-icon-info with-tooltip')

        $(span).tooltip({ placement: 'auto right', container: 'body', delay: 500 })

        return span
    }

    Surface.prototype.buildExternalParameterEditor = function(tbody) {
        var rows = tbody.children

        for (var i = 0, len = rows.length; i < len; i++) {
            var row = rows[i],
                property = row.getAttribute('data-property')

            if ($.oc.foundation.element.hasClass(row, 'no-external-parameter') || !property) {
                continue
            }

            var propertyEditor = this.findPropertyEditor(property)
            if (propertyEditor && !propertyEditor.supportsExternalParameterEditor()) {
                continue
            }

            var cell = row.querySelector('td'),
                propertyDefinition = this.findPropertyDefinition(property),
                editor = new $.oc.inspector.externalParameterEditor(this, propertyDefinition, cell)

            this.externalParameterEditors.push(editor)
        }
    }

    //
    // Field grouping
    //

    Surface.prototype.applyGroupIndexAttribute = function(property, row, group, isGroupedControl) {
        if (property.itemType == 'group' || isGroupedControl) {
            row.setAttribute('data-group-index', this.getGroupManager().getGroupIndex(group))
            row.setAttribute('data-parent-group-index', this.getGroupManager().getGroupIndex(group.parentGroup))
        }
        else {
            if (group.parentGroup) {
                row.setAttribute('data-parent-group-index', this.getGroupManager().getGroupIndex(group))
            }
        }
    }
    
    Surface.prototype.applyGroupLevelToRow = function(row, group) {
        if (row.hasAttribute('data-group-level')) {
            return
        }

        var th = this.getRowHeadElement(row)

        if (th === null) {
            throw new Error('Cannot find TH element for the Inspector row')
        }

        var groupLevel = group.getLevel()

        row.setAttribute('data-group-level', groupLevel)
        th.children[0].style.marginLeft = groupLevel*10 + 'px'
    }

    Surface.prototype.toggleGroup = function(row, forceExpand) {
        var link = row.querySelector('a'),
            groupIndex = row.getAttribute('data-group-index'),
            table = this.getRootTable(),
            groupManager = this.getGroupManager(),
            collapse = true

        if ($.oc.foundation.element.hasClass(link, 'expanded') && !forceExpand) {
            $.oc.foundation.element.removeClass(link, 'expanded')
        } else {
            $.oc.foundation.element.addClass(link, 'expanded')
            collapse = false
        }

        var propertyRows = groupManager.findGroupRows(table, groupIndex, !collapse),
            duration = Math.round(50 / propertyRows.length)

        this.expandOrCollapseRows(propertyRows, collapse, duration, forceExpand)
        groupManager.setGroupStatus(groupIndex, !collapse)
    }

    Surface.prototype.expandGroupParents = function(group) {
        var groups = group.getGroupAndAllParents(),
            table = this.getRootTable()

        for (var i = groups.length-1; i >= 0; i--) {
            var row = groups[i].findGroupRow(table)

            if (row) {
                this.toggleGroup(row, true)
            }
        }
    }

    Surface.prototype.expandOrCollapseRows = function(rows, collapse, duration, noAnimation) {
        var row = rows.pop(),
            self = this

        if (row) {
            if (!noAnimation) {
                setTimeout(function toggleRow() {
                    $.oc.foundation.element.toggleClass(row, 'collapsed', collapse)
                    $.oc.foundation.element.toggleClass(row, 'expanded', !collapse)

                    self.expandOrCollapseRows(rows, collapse, duration, noAnimation)
                }, duration)
            }
            else {
                $.oc.foundation.element.toggleClass(row, 'collapsed', collapse)
                $.oc.foundation.element.toggleClass(row, 'expanded', !collapse)

                self.expandOrCollapseRows(rows, collapse, duration, noAnimation)
            }
        }
    }

    Surface.prototype.getGroupManager = function() {
        return this.getRootSurface().groupManager
    }

    //
    // Editors
    //

    Surface.prototype.buildEditor = function(row, property, dataTable, group) {
        if (property.itemType !== 'property') {
            return
        }

        this.validateEditorType(property.type)

        var cell = document.createElement('td'),
            type = property.type

        row.appendChild(cell)

        if (type === undefined) {
            type = 'string'
        }

        var editor = new $.oc.inspector.propertyEditors[type](this, property, cell, group)

        if (editor.isGroupedEditor()) {
//            property.groupedControl = true

            $.oc.foundation.element.addClass(dataTable, 'has-groups')
            $.oc.foundation.element.addClass(row, 'control-group')

            this.applyGroupIndexAttribute(property, row, editor.group, true)
            this.buildGroupExpandControl(row.querySelector('span.title-element'), property, true, editor.hasChildSurface(), editor.group)

            if (cell.children.length == 0) {
                // If the editor hasn't added any elements to the cell,
                // and it's a grouped control, remove the cell and
                // make the group title full-width.
                row.querySelector('th').setAttribute('colspan', 2)
                row.removeChild(cell)
            }
        }
        
        this.editors.push(editor)
    }

    Surface.prototype.generateSequencedId = function() {
        this.idCounter ++

        return this.inspectorUniqueId + '-' + this.idCounter
    }

    //
    // Internal API for the editors
    //

    Surface.prototype.getPropertyValue = function(property) {
        return this.values[property]
    }

    Surface.prototype.setPropertyValue = function(property, value, supressChangeEvents, forceEditorUpdate) {
        if (value !== undefined) {
            this.values[property] = value
        }
        else {
            if (this.values[property] !== undefined) {
                delete this.values[property]
            }
        }

        if (!supressChangeEvents) {
            if (this.originalValues[property] === undefined || !this.comparePropertyValues(this.originalValues[property], value)) {
                this.markPropertyChanged(property, true)
            } 
            else {
                this.markPropertyChanged(property, false)
            }

            this.notifyEditorsPropertyChanged(property, value)

            if (this.options.onChange !== null) {
                this.options.onChange(property, value)
            }
        }

        if (forceEditorUpdate) {
            var editor = this.findPropertyEditor(property)
            if (editor) {
                editor.updateDisplayedValue(value)
            }
        }

        return value
    }

    Surface.prototype.notifyEditorsPropertyChanged = function(property, value) {
        for (var i = 0, len = this.editors.length; i < len; i++) {
            var editor = this.editors[i]

            editor.onInspectorPropertyChanged(property, value)
        }
    }

    Surface.prototype.makeCellActive = function(cell) {
        var tbody = cell.parentNode.parentNode.parentNode, // cell / row / tbody
            cells = tbody.querySelectorAll('tr td')

        for (var i = 0, len = cells.length; i < len; i++) {
            $.oc.foundation.element.removeClass(cells[i], 'active')
        }

        $.oc.foundation.element.addClass(cell, 'active')
    }

    Surface.prototype.markPropertyChanged = function(property, changed) {
        var row = this.tableContainer.querySelector('tr[data-property="'+property+'"]')

        if (changed) {
            $.oc.foundation.element.addClass(row, 'changed')
        }
        else {
            $.oc.foundation.element.removeClass(row, 'changed')
        }
    }

    Surface.prototype.findPropertyEditor = function(property) {
        for (var i = 0, len = this.editors.length; i < len; i++) {
            if (this.editors[i].getPropertyName() == property) {
                return this.editors[i]
            }
        }

        return null
    }

    Surface.prototype.findExternalParameterEditor = function(property) {
        for (var i = 0, len = this.externalParameterEditors.length; i < len; i++) {
            if (this.externalParameterEditors[i].getPropertyName() == property) {
                return this.externalParameterEditors[i]
            }
        }

        return null
    }

    Surface.prototype.findPropertyDefinition = function(property) {
        for (var i=0, len = this.parsedProperties.properties.length; i < len; i++) {
            var definition = this.parsedProperties.properties[i]

            if (definition.property == property) {
                return definition
            }
        }

        return null
    }

    Surface.prototype.validateEditorType = function(type) {
        if (type === undefined) {
            type = 'string'
        }

        if ($.oc.inspector.propertyEditors[type] === undefined) {
            throw new Error('The Inspector editor class "' + type + 
                '" is not defined in the $.oc.inspector.propertyEditors namespace.')
        }
    }

    Surface.prototype.popupDisplayed = function() {
        if (this.popupCounter === 0 && this.options.onPopupDisplayed !== null) {
            this.options.onPopupDisplayed()
        }

        this.popupCounter++
    }

    Surface.prototype.popupHidden = function() {
        this.popupCounter--

        if (this.popupCounter < 0) {
            this.popupCounter = 0
        }

        if (this.popupCounter === 0 && this.options.onPopupHidden !== null) {
            this.options.onPopupHidden()
        }
    }

    //
    // Nested surfaces support
    //

    Surface.prototype.mergeChildSurface = function(surface, mergeAfterRow) {
        var rows = surface.tableContainer.querySelectorAll('table.inspector-fields > tbody > tr')

        surface.tableContainer = this.getRootSurface().tableContainer

        for (var i = rows.length-1; i >= 0; i--) {
            var row = rows[i]

            mergeAfterRow.parentNode.insertBefore(row, mergeAfterRow.nextSibling)
            this.applyGroupLevelToRow(row, surface.group)
        }
    }

    Surface.prototype.getRowHeadElement = function(row) {
        for (var i = row.children.length-1; i >= 0; i--) {
            var element = row.children[i]

            if (element.tagName === 'TH') {
                return element
            }
        }

        return null
    }

    Surface.prototype.getInspectorUniqueId = function() {
        return this.inspectorUniqueId
    }

    Surface.prototype.getRootSurface = function() {
        var current = this

        while (current) {
            if (!current.parentSurface) {
                return current
            }

            current = current.parentSurface
        }
    }

    //
    // Disposing
    //

    Surface.prototype.removeElements = function() {
        if (!this.parentSurface) {
            this.tableContainer.parentNode.removeChild(this.tableContainer);
        }
    }

    Surface.prototype.disposeEditors = function() {
        for (var i = 0, len = this.editors.length; i < len; i++) {
            var editor = this.editors[i]

            editor.dispose()
        }
    }

    Surface.prototype.disposeExternalParameterEditors = function() {
        for (var i = 0, len = this.externalParameterEditors.length; i < len; i++) {
            var editor = this.externalParameterEditors[i]

            editor.dispose()
        }
    }

    Surface.prototype.disposeControls = function() {
        var tooltipControls = this.tableContainer.querySelectorAll('.with-tooltip')

        for (var i = 0, len = tooltipControls.length; i < len; i++) {
            $(tooltipControls[i]).tooltip('destroy')
        }
    }

    //
    // Helpers
    //

    Surface.prototype.escapeJavascriptString = function(str) {
        var div = document.createElement('div')
        div.appendChild(document.createTextNode(str))
        return div.innerHTML
    }

    Surface.prototype.comparePropertyValues = function(oldValue, newValue) {
        if (oldValue === undefined && newValue !== undefined) {
            return false
        }

        if (oldValue !== undefined && newValue === undefined) {
            return false
        }

        if (typeof oldValue == 'object' && typeof newValue == 'object') {
            return JSON.stringify(oldValue) == JSON.stringify(newValue)
        }

        return oldValue == newValue
    }

    Surface.prototype.getRootTable = function() {
        return this.getRootSurface().container.querySelector('table.inspector-fields')
    }

    //
    // External API
    //

    Surface.prototype.getValues = function() {
        var result = {}

        for (var i=0, len = this.parsedProperties.properties.length; i < len; i++) {
            var property = this.parsedProperties.properties[i]

            if (property.itemType !== 'property') {
                continue
            }

            var value = null,
                externalParameterEditor = this.findExternalParameterEditor(property.property)

            if (!externalParameterEditor || !externalParameterEditor.isEditorVisible()) {
                value = this.getPropertyValue(property.property)

                if (value === undefined) {
                    var editor = this.findPropertyEditor(property.property)

                    if (editor) {
                        value = editor.getUndefinedValue()
                    }
                    else {
                        value = property.default
                    }
                }

                if (value === $.oc.inspector.removedProperty) {
                    continue
                }
            } 
            else {
                value = externalParameterEditor.getValue()
                value = '{{ ' + value + ' }}'
            }

            result[property.property] = value
        }

        return result
    }

    Surface.prototype.validate = function() {
        this.getGroupManager().unmarkInvalidGroups(this.getRootTable())

        for (var i = 0, len = this.editors.length; i < len; i++) {
            var editor = this.editors[i],
                externalEditor = this.findExternalParameterEditor(editor.propertyDefinition.property)

            if (externalEditor && externalEditor.isEditorVisible()) {
                if (!externalEditor.validate()) {
                    editor.markInvalid()
                    return false
                }
                else {
                    continue
                }
            }

            if (!editor.validate()) {
                editor.markInvalid()
                return false
            }
        }

        return true
    }

    Surface.prototype.hasChanges = function() {
        return !this.comparePropertyValues(this.originalValues, this.values)
    }

    // EVENT HANDLERS
    //

    Surface.prototype.onGroupClick = function(ev) {
        var row = ev.currentTarget

        this.toggleGroup(row)

        $.oc.foundation.event.stop(ev)
        return false
    }

    // DEFAULT OPTIONS
    // ============================

    Surface.DEFAULTS = {
        enableExternalParameterEditor: false,
        onChange: null,
        onPopupDisplayed: null,
        onPopupHidden: null
    }

    // REGISTRATION
    // ============================

    $.oc.inspector.surface = Surface
    $.oc.inspector.removedProperty = {removed: true}
}(window.jQuery);