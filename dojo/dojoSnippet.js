/*******************************************************************************
 * @license
 * Copyright (c) 2010, 2012 IBM Corporation and others.
 * All rights reserved. This program and the accompanying materials are made 
 * available under the terms of the Eclipse Public License v1.0 
 * (http://www.eclipse.org/legal/epl-v10.html), and the Eclipse Distribution 
 * License v1.0 (http://www.eclipse.org/org/documents/edl-v10.html). 
 *
 * Contributors:
 *     IBM Corporation - initial API and implementation
 *******************************************************************************/

/*global define */
define([
	'dojo/_base/declare', //$NON-NLS-0$
	'dijit/_WidgetBase', //$NON-NLS-0$
	'dijit/_TemplatedMixin', //$NON-NLS-0$
	'orion/editor/edit' //$NON-NLS-0$
], function(declare, WidgetBase, TemplatedMixin, edit) {
	var cls = declare([WidgetBase, TemplatedMixin], {
		templateString: "<div class='editor' data-editor-lang='js' data-dojo-attach-point='editorParent'></div>", //$NON-NLS-0$
		startup: function() {
			this.inherited(arguments);
			this.editor = edit({parent:this.editorParent});
		}
	});
	return cls;
});
