/*******************************************************************************
 * @license
 * Copyright (c) 2013 IBM Corporation and others.
 * All rights reserved. This program and the accompanying materials are made 
 * available under the terms of the Eclipse Public License v1.0 
 * (http://www.eclipse.org/legal/epl-v10.html), and the Eclipse Distribution 
 * License v1.0 (http://www.eclipse.org/org/documents/edl-v10.html). 
 * 
 * Contributors: IBM Corporation - initial API and implementation
 ******************************************************************************/

/*global define */
define(['i18n!orion/navigate/nls/messages', 'orion/Deferred', 'orion/extensionCommands'], function(messages, Deferred, mExtensionCommands){

	/**
	 * Creates a new project client.
	 * @class Project client provides client-side API to handle projects based on given file client.
	 * @name orion.projectClient.ProjectClient
	 */
	function ProjectClient(serviceRegistry, fileClient) {
		this.serviceRegistry = serviceRegistry;
		this.fileClient = fileClient;
		this.allProjectHandlersReferences = serviceRegistry.getServiceReferences("orion.project.handler"); //$NON-NLS-0$
		this._serviceRegistration = serviceRegistry.registerService("orion.project.client", this); //$NON-NLS-0$ 
	}

	ProjectClient.prototype = /**@lends orion.ProjectClient.ProjectClient.prototype */ {
		_getProjectJsonData : function(folderMetadata, children, workspace){
			var deferred = new Deferred();
			for(var i=0; i<children.length; i++){
				if(children[i].Name === "project.json"){
					this.fileClient.read(children[i].Location).then(function(content){
						try{
							var projectJson = content && content.length>0 ? JSON.parse(content) : {};
							projectJson.Name = projectJson.Name || folderMetadata.Name;
							projectJson.ContentLocation = folderMetadata.Location;
							projectJson.WorkspaceLocation = workspace.Location;
							projectJson.ProjectJsonLocation = children[i].Location;
							deferred.resolve(projectJson);
						} catch (e){
							deferred.reject(e);
						}
					}, function(error){deferred.reject(error);}, function(progress){deferred.progress(progress);});
					return deferred;
				}
			}
			deferred.resolve(null);
			return deferred;
		},
		readAllProjects : function(workspaceMetadata){
			var deferred = new Deferred();

			if(!workspaceMetadata.Children){
				deferred.resolve([]);
				return deferred;
			}	
			var projects = [];
			var projectDeferrds = [];
			for(var i=0; i<workspaceMetadata.Children.length; i++){
				var projectDeferred = new Deferred();
				this.readProject(workspaceMetadata.Children[i], workspaceMetadata).then(projectDeferred.resolve,
					function(error){
						this.resolve(null);
					}.bind(projectDeferred));
				projectDeferrds.push(projectDeferred);
				projectDeferred.then(function(projectMetadata){
					if(projectMetadata){
						projects.push(projectMetadata);
					}
				});
			}
			Deferred.all(projectDeferrds).then(function(){
				deferred.resolve(projects);
			});
			return deferred;
		},
		readProject : function(fileMetadata, workspaceMetadata){
			var that = this;
			var deferred = new Deferred();
			
			function readProjectFromWorkspace(fileMetadata, workspace, deferred){
				if(fileMetadata.Parents && fileMetadata.Parents.length>0){
					var topFolder = fileMetadata.Parents[fileMetadata.Parents.length-1];
					if(topFolder.Children){
						that._getProjectJsonData.bind(that)(topFolder, topFolder.Children, workspace).then(deferred.resolve, deferred.reject, deferred.progress);
					} else if(topFolder.ChildrenLocation) {
						this.fileClient.fetchChildren(topFolder.ChildrenLocation).then(function(children){
							that._getProjectJsonData.bind(that)(topFolder, children, workspace).then(deferred.resolve, deferred.reject, deferred.progress);
						},
						deferred.reject,
						deferred.progress);
					} else {
						deferred.resolve(null);
					}
					return deferred;
				} else if(fileMetadata.Children) {
					that._getProjectJsonData.bind(that)(fileMetadata, fileMetadata.Children, workspace).then(deferred.resolve, deferred.reject, deferred.progress);
					return deferred;
				} else if(fileMetadata.ChildrenLocation){
					this.fileClient.fetchChildren(fileMetadata.ChildrenLocation).then(function(children){
						that._getProjectJsonData.bind(that)(fileMetadata, children, workspace).then(deferred.resolve, deferred.reject, deferred.progress);
					},
					deferred.reject,
					deferred.progress);
					return deferred;
				} else {
					deferred.resolve(null);
					return deferred;
				}
			}
			if(workspaceMetadata){
				readProjectFromWorkspace.call(that, fileMetadata, workspaceMetadata, deferred);
			} else {
				this.fileClient.loadWorkspace().then(function(workspace){
					readProjectFromWorkspace.call(that, fileMetadata, workspace, deferred);
				});
			}
			return deferred;
		},
		
		/**
		 * Initializes a project in a folder.
		 * @param {String} contentLocation The location of the parent folder
		 * @return {Object} projectMetadata JSON representation of the created folder
		 */
		initProject : function(contentLocation, projectMetadata){
			var that = this;
			var deferred = new Deferred();
			this.fileClient.createFile(contentLocation, "project.json").then(function(fileMetadata){
				if(projectMetadata){
					that.fileClient.write(fileMetadata.Location, JSON.stringify(projectMetadata)).then(function(){
						deferred.resolve({ContentLocation: contentLocation, projectMetadata: projectMetadata});
					}, deferred.reject, deferred.progress);
				} else {
					deferred.resolve({fileMetadata: fileMetadata});
				}
			}, 
				deferred.reject,
				deferred.progress);
			
			return deferred;
		},
		
		createProject: function(workspaceLocation, projectMetadata){
				return this.fileClient.createProject(workspaceLocation, projectMetadata.Name, null, true).then(function(fileMetadata){
					delete projectMetadata.Name;
					return this.initProject(fileMetadata.ContentLocation, projectMetadata);
				}.bind(this), 
				function(error){return error;},
				function(progress){return progress;}
			);
		},
		
		getDependencyFileMetadata : function(dependency, workspaceLocation){
			var deferred = new Deferred();
			if(dependency.Type==="file"){
				return this.fileClient.loadWorkspace(workspaceLocation).then(function(workspace){
					var path = dependency.Location.split("/");
					for(var i=0; i<workspace.Children.length; i++){
						var child = workspace.Children[i];
						if (child.Name===path[0]) {
							path.shift();
							return this.fileClient.read(child.Location + path.join("/"), true);
						}
					}
					return deferred.reject(dependency.Location + " could not be found in your workspace");
				}.bind(this));
			} else {
				var handler = this.getProjectHandler(dependency.Type);
				if(handler===null){
					deferred.reject(dependency.Type + " is not supported.");
					return deferred;
				}
				var validator;
				if(handler.validationProperties){
					validator = mExtensionCommands._makeValidator(handler, this.serviceRegistry, []);
				}
				
				this.fileClient.loadWorkspace(workspaceLocation).then(function(workspace){
					var checkdefs = [];
					var found = false;
					for(var i=0; i<workspace.Children.length; i++){
						if(found===true){
							break;
						}
						if(validator && validator.validationFunction(workspace.Children[i])){
							var def = handler.getDependencyDescription(workspace.Children[i]);
							checkdefs.push(def);
							(function(i, def){
								def.then(function(matches){
									if(matches && matches.Location === dependency.Location){
										found = true;
										deferred.resolve(workspace.Children[i]);
									}
								});
							})(i, def);
						}
					}
					Deferred.all(checkdefs).then(function(){
						if(!found){
							deferred.reject(dependency.Name + " could not be found in your workspace");
						}
					});
				}, deferred.reject);
			}
			return deferred;
		},
		/**
		* @param {Object} projectMetadata Project metadata
		* @param {Object} dependency The JSON representation of the dependency
		* @param {String} dependency.Type Type of the dependency (i.e. "file")
		* @param {String} dependency.Name String description of the dependency (i.e. folder name)
		* @param {String} dependency.Location Location of the dependency understood by the plugin of given type
		*/
	addProjectDependency: function(projectMetadata, dependency){
		var deferred = new Deferred();
		this.fileClient.fetchChildren(projectMetadata.ContentLocation).then(function(children){
			for(var i=0; i<children.length; i++){
				if(children[i].Name==="project.json"){
					this.fileClient.read(children[i].Location).then(function(content){
						try{
							var projectJson = content && content.length>0 ? JSON.parse(content) : {};
							if(!projectJson.Dependencies){
								projectJson.Dependencies = [];
							}
							for(var j=0; j<projectJson.Dependencies.length; j++){
								if(projectJson.Dependencies[j].Location === dependency.Location){
									deferred.resolve(projectJson);	
									return;
								}
							}
							projectJson.Dependencies.push(dependency);
							this.fileClient.write(children[i].Location, JSON.stringify(projectJson)).then(
								function(){
									projectJson.ContentLocation = projectMetadata.ContentLocation;
									projectJson.Name = projectMetadata.Name;
									deferred.resolve(projectJson);
								},
								deferred.reject
							);
							
							deferred.resolve(projectJson);
						} catch (e){
							deferred.reject(e);
						}
					}.bind(this), deferred.reject, deferred.progress);
					return;
				}
			}
		}.bind(this), deferred.reject);
		return deferred;
	},
	
	removeProjectDependency: function(projectMetadata, dependency){
		var deferred = new Deferred();
		this.fileClient.fetchChildren(projectMetadata.ContentLocation).then(function(children){
			for(var i=0; i<children.length; i++){
				if(children[i].Name==="project.json"){
					this.fileClient.read(children[i].Location).then(function(content){
						try{
							var projectJson = content && content.length>0 ? JSON.parse(content) : {};
							if(!projectJson.Dependencies){
								projectJson.Dependencies = [];
							}
							for(var j=projectJson.Dependencies.length-1; j>=0; j--){
								if(projectJson.Dependencies[j].Location === dependency.Location && projectJson.Dependencies[j].Type === dependency.Type){
									projectJson.Dependencies.splice(j,1);
								}
							}
							this.fileClient.write(children[i].Location, JSON.stringify(projectJson)).then(
								function(){
									projectJson.ContentLocation = projectMetadata.ContentLocation;
									projectJson.Name = projectMetadata.Name;
									deferred.resolve(projectJson);
								},
								deferred.reject
							);
							
						} catch (e){
							deferred.reject(e);
						}
					}.bind(this), deferred.reject, deferred.progress);
					return;
				}
			}
		}.bind(this), deferred.reject);
		return deferred;
	},
	
	changeProjectProperties: function(projectMetadata, properties){
		if(!properties){
			return;
		}
		var deferred = new Deferred();
		
		function saveProperties(projectJsonLocation){
			this.fileClient.read(projectJsonLocation).then(function(content){
				try{
					var projectJson = content && content.length>0 ? JSON.parse(content) : {};
					for(var key in properties){
						projectJson[key] = properties[key];
					}
					this.fileClient.write(projectJsonLocation, JSON.stringify(projectJson)).then(
						function(){
							projectJson.ContentLocation = projectMetadata.ContentLocation;
							projectJson.ProjectJsonLocation = projectJsonLocation;
							projectJson.Name = projectMetadata.Name;
							deferred.resolve(projectJson);
						},
						deferred.reject
					);
					
				} catch (e){
					deferred.reject(e);
				}
			}.bind(this), deferred.reject);
		}
		
		if(projectMetadata.ProjectJsonLocation){
			saveProperties.bind(this)(projectMetadata.ProjectJsonLocation);
		}
		return deferred;
	},
	
	getProjectHandlerTypes: function(){
		var types = [];
		for(var i=0; i<this.allProjectHandlersReferences.length; i++){
			types.push(this.allProjectHandlersReferences[i].getProperty("type"));
		}
		return types;
	},
	
	_getProjectHandlerService: function(serviceReference){
		var service = this.serviceRegistry.getService(serviceReference);
		service.id = serviceReference.getProperty("id");
		service.addParamethers =  serviceReference.getProperty("addParamethers");
		service.optionalParamethers = serviceReference.getProperty("optionalParamethers");
		service.addDependencyName =  serviceReference.getProperty("addDependencyName");
		service.addDependencyTooltip = serviceReference.getProperty("addDependencyTooltip");
		service.type = serviceReference.getProperty("type");
		service.actionComment = serviceReference.getProperty("actionComment");
		service.addProjectName = serviceReference.getProperty("addProjectName");
		service.addProjectTooltip = serviceReference.getProperty("addProjectTooltip");
		service.validationProperties = serviceReference.getProperty("validationProperties");
		return service;
	},
	
	getProjectHandler: function(type){
		for(var i=0; i<this.allProjectHandlersReferences.length; i++){
			if(this.allProjectHandlersReferences[i].getProperty("type") === type){
				return this._getProjectHandlerService(this.allProjectHandlersReferences[i]);
			}
		}
	},
	
	getMatchingProjectHandlers: function(item){
		var handlers = [];
		for(var i=0; i<this.allProjectHandlersReferences.length; i++){
			var handlerInfo = this.allProjectHandlersReferences[i]._properties;
			var validator = mExtensionCommands._makeValidator(handlerInfo, this.serviceRegistry, []);
			if(validator.validationFunction(item)){
				handlers.push(this._getProjectHandlerService(this.allProjectHandlersReferences[i]));
			}
		}
		return handlers;
	}
		
	};//end ProjectClient prototype
	ProjectClient.prototype.constructor = ProjectClient;

	//return the module exports
	return {ProjectClient: ProjectClient};
});